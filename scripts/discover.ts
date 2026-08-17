/**
 * Run discovery from the terminal: `npm run discover`
 *
 * Nothing runs on a schedule on your own machine — Vercel Cron and the GitHub
 * Actions workflow only fire against a deployed app. This is how you pull new
 * jobs locally.
 *
 *   npm run discover                 # poll boards, enrich, score per your settings
 *   npm run discover -- --budget 120 # give it two minutes instead of the default
 *   npm run discover -- --score      # score this run even if scoring is on-demand
 *   npm run discover -- --url https://your-app.vercel.app
 *
 * Self-contained: it signs in over HTTP rather than importing the app, so it
 * works against localhost or a deployment without a bundler.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function loadEnv(): Promise<void> {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(path.join(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
        if (!m?.[1]) continue;
        let v = (m[2] ?? "").trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
      }
      return;
    } catch {
      // Try the next candidate.
    }
  }
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? "";
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Sign in and return the session cookie. */
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
  if (cookie.length === 0) throw new Error("Login returned no cookie.");
  return cookie;
}

async function main(): Promise<void> {
  await loadEnv();

  const baseUrl = (
    arg("url") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");

  const password = process.env.APP_PASSWORD;
  if (!password) {
    console.error("APP_PASSWORD is not set. See .env.example.");
    process.exit(1);
  }

  const budgetSeconds = Number(arg("budget") ?? 90);
  const budgetMs = Number.isFinite(budgetSeconds) ? budgetSeconds * 1000 : 90_000;

  console.log(`\n  Running discovery against ${baseUrl}`);
  console.log(`  Budget: ${Math.round(budgetMs / 1000)}s\n`);

  let cookie: string;
  try {
    cookie = await signIn(baseUrl, password);
  } catch (error) {
    console.error(
      `  ${error instanceof Error ? error.message : String(error)}\n\n` +
        `  Is the app running? Start it with: npm run dev\n`,
    );
    process.exit(1);
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs + 30_000);

  try {
    const response = await fetch(`${baseUrl}/api/sources/run`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        maxSources: Number(arg("sources") ?? 500),
        // Scoring normally follows the mode set in Settings; --score forces it
        // on for this run.
        maxScored: has("score") ? Number(arg("score") || 50) : 40,
        maxEnrichments: 100,
        timeBudgetMs: budgetMs,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`  Discovery failed (HTTP ${response.status}): ${body.slice(0, 200)}\n`);
      process.exit(1);
    }

    const result = (await response.json()) as Record<string, unknown> & {
      errors?: { source: string; error: string }[];
      scoringSkipped?: string;
    };

    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  Finished in ${seconds}s\n`);

    for (const key of [
      "sourcesRun",
      "sourcesFailed",
      "sourcesSkipped",
      "postingsSeen",
      "jobsNew",
      "jobsUpdated",
      "jobsDuplicate",
      "passedPrefilter",
      "enriched",
      "scored",
    ]) {
      console.log(`    ${key.padEnd(18)} ${String(result[key] ?? 0)}`);
    }

    if (result.scoringSkipped !== undefined) {
      console.log(
        `\n  Scoring skipped (mode: ${result.scoringSkipped}). ` +
          `Score a job from its page, or change it in Settings.`,
      );
    }

    const errors = result.errors ?? [];
    if (errors.length > 0) {
      console.log(`\n  ${errors.length} source(s) failed:`);
      for (const item of errors.slice(0, 8)) {
        console.log(`    ${item.source}: ${String(item.error).slice(0, 70)}`);
      }
    }

    console.log(`\n  Open ${baseUrl}/discover to see them.\n`);
  } catch (error) {
    if (controller.signal.aborted) {
      console.error(`\n  Timed out. The server may still be working — reload /discover.\n`);
      process.exit(1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error: unknown) => {
  console.error("\nDiscovery failed:\n", error);
  process.exit(1);
});
