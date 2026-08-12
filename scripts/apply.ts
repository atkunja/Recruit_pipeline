/**
 * Application assistant: `npm run apply -- <applicationId>`
 *
 * Opens the posting in a real browser, fills what it can from your approved
 * application package, and then STOPS. It never clicks submit.
 *
 * Why this is a local CLI and not a route: Playwright drives a full Chromium,
 * which does not belong in a serverless function — it would blow past every
 * size and time limit, and it needs to be visible so you can watch it work and
 * take over.
 *
 * Flow:
 *   1. sign in to the app with APP_PASSWORD
 *   2. fetch the application package (profile, answers, resume)
 *   3. refuse to continue if the package reports blockers
 *   4. download the approved resume PDF to a temp file
 *   5. open the posting, fill known fields, upload the resume
 *   6. report what it filled, what it skipped, and hand you the keyboard
 *
 * Self-contained: imports nothing from src/, so Node runs it directly.
 */
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { chromium, type Page } from "playwright";

interface FieldSelector {
  field: string;
  selectors: string[];
  file?: boolean;
}

interface ApplicationPackage {
  applicationId: number;
  job: { title: string; company: string; url: string; location: string | null };
  ats: { platform: string; support: string; note: string };
  profile: Record<string, string | boolean | null>;
  resume: { versionId: number; pdfPath: string; filename: string } | null;
  questions: {
    id: number;
    question: string;
    answer: string | null;
    needsReview: boolean;
    isSensitive: boolean;
  }[];
  blockers: string[];
}

// Mirrors src/lib/apply/ats.ts. Duplicated rather than imported so this script
// stays runnable by plain Node with no bundler.
const FIELD_MAPS: Record<string, FieldSelector[]> = {
  greenhouse: [
    { field: "firstName", selectors: ["#first_name", "input[name='first_name']"] },
    { field: "lastName", selectors: ["#last_name", "input[name='last_name']"] },
    { field: "email", selectors: ["#email", "input[name='email']", "input[type='email']"] },
    { field: "phone", selectors: ["#phone", "input[name='phone']", "input[type='tel']"] },
    { field: "resume", selectors: ["#resume", "input[type='file']"], file: true },
    { field: "linkedin", selectors: ["input[name*='linkedin' i]", "input[id*='linkedin' i]"] },
    { field: "github", selectors: ["input[name*='github' i]", "input[id*='github' i]"] },
    { field: "school", selectors: ["input[name*='school' i]", "input[id*='school' i]"] },
  ],
  lever: [
    { field: "fullName", selectors: ["input[name='name']", "#name"] },
    { field: "email", selectors: ["input[name='email']", "input[type='email']"] },
    { field: "phone", selectors: ["input[name='phone']", "input[type='tel']"] },
    { field: "location", selectors: ["input[name='location']", "#location"] },
    { field: "resume", selectors: ["input[name='resume']", "input[type='file']"], file: true },
    { field: "linkedin", selectors: ["input[name='urls[LinkedIn]']", "input[name*='linkedin' i]"] },
    { field: "github", selectors: ["input[name='urls[GitHub]']", "input[name*='github' i]"] },
    { field: "portfolio", selectors: ["input[name='urls[Portfolio]']"] },
  ],
  ashby: [
    { field: "fullName", selectors: ["input[name='_systemfield_name']", "input[aria-label*='Name' i]"] },
    { field: "email", selectors: ["input[name='_systemfield_email']", "input[type='email']"] },
    { field: "phone", selectors: ["input[name='_systemfield_phone']", "input[type='tel']"] },
    { field: "resume", selectors: ["input[type='file']"], file: true },
    { field: "linkedin", selectors: ["input[aria-label*='LinkedIn' i]"] },
    { field: "github", selectors: ["input[aria-label*='GitHub' i]"] },
  ],
  workday: [
    { field: "firstName", selectors: ["input[data-automation-id='legalNameSection_firstName']"] },
    { field: "lastName", selectors: ["input[data-automation-id='legalNameSection_lastName']"] },
    { field: "email", selectors: ["input[data-automation-id='email']", "input[type='email']"] },
    { field: "phone", selectors: ["input[data-automation-id='phone-number']", "input[type='tel']"] },
    { field: "resume", selectors: ["input[data-automation-id='file-upload-input-ref']", "input[type='file']"], file: true },
  ],
  unknown: [],
};

async function loadEnvFile(): Promise<void> {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(path.join(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
        if (!match) continue;
        const key = match[1];
        let value = (match[2] ?? "").trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
      return;
    } catch {
      // Next candidate.
    }
  }
}

/** Sign in and return the session cookie header. */
async function signIn(baseUrl: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
    redirect: "manual",
  });

  if (!response.ok) {
    throw new Error(
      `Could not sign in to ${baseUrl} (HTTP ${response.status}). Check APP_PASSWORD.`,
    );
  }

  const cookie = response.headers.getSetCookie?.().join("; ") ?? "";
  if (cookie.length === 0) throw new Error("Login succeeded but returned no cookie.");
  return cookie;
}

async function main(): Promise<void> {
  await loadEnvFile();

  const applicationId = Number(process.argv[2]);
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    console.error("Usage: npm run apply -- <applicationId>");
    process.exit(1);
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const password = process.env.APP_PASSWORD;
  if (!password) {
    console.error("APP_PASSWORD is not set. See .env.example.");
    process.exit(1);
  }

  const force = process.argv.includes("--force");

  console.log(`\n  Signing in to ${baseUrl} …`);
  const cookie = await signIn(baseUrl, password);

  const response = await fetch(
    `${baseUrl}/api/applications/${applicationId}/package`,
    { headers: { cookie } },
  );
  if (!response.ok) {
    console.error(`Could not load the application package (HTTP ${response.status}).`);
    process.exit(1);
  }
  const pkg = (await response.json()) as ApplicationPackage;

  console.log(`\n  ${pkg.job.company} — ${pkg.job.title}`);
  console.log(`  ${pkg.job.url}`);
  console.log(`  ATS: ${pkg.ats.platform} (${pkg.ats.support}) — ${pkg.ats.note}\n`);

  if (pkg.blockers.length > 0) {
    console.log("  ⚠  This application is not ready:");
    for (const blocker of pkg.blockers) console.log(`     - ${blocker}`);
    if (!force) {
      console.log("\n  Fix these in the app first, or re-run with --force to fill anyway.\n");
      process.exit(1);
    }
    console.log("\n  --force given; continuing anyway.\n");
  }

  // Resume PDF to a temp file for the file input.
  let resumePath: string | null = null;
  let tempDir: string | null = null;
  if (pkg.resume !== null) {
    tempDir = await mkdtemp(path.join(tmpdir(), "recruiting-pipeline-"));
    const pdf = await fetch(`${baseUrl}${pkg.resume.pdfPath}`, {
      headers: { cookie },
    });
    if (pdf.ok) {
      resumePath = path.join(tempDir, pkg.resume.filename);
      await writeFile(resumePath, Buffer.from(await pdf.arrayBuffer()));
      console.log(`  Resume ready: ${resumePath}`);
    } else {
      console.log(`  ⚠  Could not download the resume (HTTP ${pdf.status}).`);
    }
  }

  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await context.newPage();

  const filled: string[] = [];
  const skipped: string[] = [];

  try {
    await page.goto(pkg.job.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Give client-rendered forms (Ashby, Workday) a moment to mount.
    await page.waitForTimeout(2500);
    await dismissCookieBanner(page);

    const fields = FIELD_MAPS[pkg.ats.platform] ?? [];
    if (fields.length === 0) {
      console.log(
        "\n  No field map for this system — leaving the form to you.\n",
      );
    }

    for (const field of fields) {
      const value = pkg.profile[field.field];

      if (field.file) {
        if (resumePath === null) {
          skipped.push("resume (no file)");
          continue;
        }
        const ok = await uploadFile(page, field.selectors, resumePath);
        (ok ? filled : skipped).push("resume");
        continue;
      }

      if (typeof value !== "string" || value.length === 0) {
        skipped.push(`${field.field} (nothing on file)`);
        continue;
      }

      const ok = await fillField(page, field.selectors, value);
      (ok ? filled : skipped).push(field.field);
    }

    console.log("\n  ── Filled ─────────────────────────────");
    for (const item of filled) console.log(`   ✓ ${item}`);
    if (skipped.length > 0) {
      console.log("\n  ── Not filled (do these yourself) ─────");
      for (const item of skipped) console.log(`   • ${item}`);
    }

    if (pkg.questions.length > 0) {
      console.log("\n  ── Prepared answers (copy as needed) ──");
      for (const question of pkg.questions) {
        const flag = question.needsReview ? " [NEEDS YOUR INPUT]" : "";
        const sensitive = question.isSensitive ? " [you answer this one]" : "";
        console.log(`\n   Q: ${question.question}${flag}${sensitive}`);
        console.log(`   A: ${question.answer ?? "(blank)"}`);
      }
    }

    console.log(
      "\n  ───────────────────────────────────────\n" +
        "  The browser is open and NOTHING has been submitted.\n" +
        "  Review every field, answer anything flagged above, then submit yourself.\n",
    );

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      "  Did you submit it? Type 'y' to mark it applied, anything else to leave it: ",
    );
    rl.close();

    if (answer.trim().toLowerCase().startsWith("y")) {
      const marked = await fetch(
        `${baseUrl}/api/applications/${applicationId}/submitted`,
        { method: "POST", headers: { cookie } },
      );
      console.log(
        marked.ok
          ? "\n  Marked as applied.\n"
          : `\n  Could not update the status (HTTP ${marked.status}).\n`,
      );
    } else {
      console.log("\n  Left as-is.\n");
    }
  } finally {
    await browser.close();
    if (tempDir !== null) await rm(tempDir, { recursive: true, force: true });
  }
}

/** Try each selector until one is visible, then type into it. */
async function fillField(
  page: Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.isVisible({ timeout: 1200 }))) continue;
      if (!(await locator.isEditable({ timeout: 800 }))) continue;

      // Don't clobber something already filled — a browser autofill or a
      // resume parse may have got there first and be more correct.
      const existing = await locator.inputValue().catch(() => "");
      if (existing.trim().length > 0) return true;

      await locator.fill(value);
      return true;
    } catch {
      // Try the next selector.
    }
  }
  return false;
}

async function uploadFile(
  page: Page,
  selectors: string[],
  filePath: string,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.setInputFiles(filePath, { timeout: 4000 });
      return true;
    } catch {
      // Try the next selector.
    }
  }
  return false;
}

/**
 * Dismiss a cookie banner if one is covering the form.
 * Chooses the reject/necessary-only option where one exists.
 */
async function dismissCookieBanner(page: Page): Promise<void> {
  const candidates = [
    "button:has-text('Reject all')",
    "button:has-text('Reject All')",
    "button:has-text('Only necessary')",
    "button:has-text('Necessary only')",
    "button:has-text('Decline')",
    "#onetrust-reject-all-handler",
  ];
  for (const selector of candidates) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 900 })) {
        await locator.click();
        await page.waitForTimeout(400);
        return;
      }
    } catch {
      // No banner, or a different one. Not worth failing over.
    }
  }
}

main().catch((error: unknown) => {
  console.error("\nApplication assistant failed:\n", error);
  process.exit(1);
});
