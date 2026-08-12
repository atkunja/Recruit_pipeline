/**
 * Interactive environment setup: `npm run setup`
 *
 * Prompts for the handful of values only you can supply, generates the random
 * ones, and writes `.env.local`. Secrets are masked as you type and are never
 * printed back, never passed as shell arguments, and never land in shell
 * history.
 *
 * Safe to re-run: it only asks about values that are still missing, and it
 * shows what it is about to change before writing.
 *
 * Self-contained so Node runs it directly.
 */
import { readFile, writeFile, access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";

const ENV_PATH = path.join(process.cwd(), ".env.local");
const EXAMPLE_PATH = path.join(process.cwd(), ".env.example");

/** A value that still needs filling in. */
const PLACEHOLDER = /^(|REPLACE_ME.*|change-me.*|sk-\.\.\.|.*<ref>.*|.*<password>.*)$/;

function isPlaceholder(value: string | undefined): boolean {
  return value === undefined || PLACEHOLDER.test(value.trim());
}

/**
 * Prompt on the terminal.
 * When `hidden`, keystrokes are echoed as asterisks by overriding readline's
 * output writer — the value itself never reaches the screen or scrollback.
 */
function ask(prompt: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    }) as ReturnType<typeof createInterface> & {
      muted?: boolean;
      _writeToOutput?: (text: string) => void;
      output?: NodeJS.WriteStream;
    };

    if (hidden) {
      rl.muted = false;
      rl._writeToOutput = function write(text: string) {
        // Echo the prompt itself, mask everything typed after it.
        if (rl.muted === true) process.stdout.write("*");
        else process.stdout.write(text);
      };
    }

    rl.question(prompt, (answer) => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });

    if (hidden) rl.muted = true;
  });
}

function parse(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    let value = (match[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

/** Replace a key's value, appending the key if it isn't there. */
function setValue(text: string, key: string, value: string): string {
  const pattern = new RegExp(`^(\\s*${key}\\s*=).*$`, "m");
  const replacement = `${key}="${value}"`;
  return pattern.test(text) ? text.replace(pattern, replacement) : `${text}\n${replacement}\n`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("\n  Recruiting Pipeline — environment setup\n");

  if (!(await exists(ENV_PATH))) {
    if (!(await exists(EXAMPLE_PATH))) {
      console.error("  Neither .env.local nor .env.example exists. Are you in the project root?");
      process.exit(1);
    }
    await writeFile(ENV_PATH, await readFile(EXAMPLE_PATH, "utf8"));
    console.log("  Created .env.local from .env.example\n");
  }

  let text = await readFile(ENV_PATH, "utf8");
  const values = parse(text);
  const changed: string[] = [];

  // --- database ------------------------------------------------------------
  const dbUrl = values.get("DATABASE_URL") ?? "";
  const needsHost = isPlaceholder(dbUrl) || dbUrl.includes("<ref>");
  const needsPassword = dbUrl.includes("REPLACE_ME") || dbUrl.includes("<password>");

  if (needsHost) {
    console.log("  Supabase → your project → Connect → Session pooler");
    console.log("  Paste the whole connection string (the one ending :5432/postgres).\n");
    const pasted = await ask("  Session pooler URL: ");

    const match = /postgres(?:ql)?:\/\/([^:]+):([^@]*)@([^:/]+):(\d+)/.exec(pasted);
    if (!match?.[1] || !match[3]) {
      console.error("\n  That doesn't look like a postgres:// URL. Re-run npm run setup.\n");
      process.exit(1);
    }
    const [, user, , host] = match;

    text = setValue(text, "DATABASE_URL", `postgresql://${user}:REPLACE_ME_DB_PASSWORD@${host}:6543/postgres`);
    text = setValue(text, "DIRECT_DATABASE_URL", `postgresql://${user}:REPLACE_ME_DB_PASSWORD@${host}:5432/postgres`);
    changed.push("DATABASE_URL", "DIRECT_DATABASE_URL");
  }

  if (needsHost || needsPassword) {
    console.log("\n  Your Supabase DATABASE password (not your Supabase login).");
    console.log("  Forgot it? Settings → Database → Reset database password.");
    const password = await ask("  Database password: ", true);

    if (password.length === 0) {
      console.error("\n  No password entered. Nothing written.\n");
      process.exit(1);
    }
    // Percent-encode so @ : / # ? & in a password can't break the URL.
    const encoded = encodeURIComponent(password);
    text = text.replaceAll("REPLACE_ME_DB_PASSWORD", encoded);
    text = text.replaceAll("<password>", encoded);
    if (!changed.includes("DATABASE_URL")) changed.push("database password");
  }

  // --- OpenAI --------------------------------------------------------------
  if (isPlaceholder(values.get("OPENAI_API_KEY"))) {
    console.log("\n  OpenAI API key — platform.openai.com/api-keys");
    const key = await ask("  OpenAI key (blank to skip): ", true);
    if (key.length > 0) {
      text = setValue(text, "OPENAI_API_KEY", key);
      changed.push("OPENAI_API_KEY");
    }
  }

  // --- Gmail (optional) ----------------------------------------------------
  if (isPlaceholder(values.get("GOOGLE_CLIENT_ID"))) {
    console.log("\n  Gmail is optional — press Enter twice to skip.");
    const clientId = await ask("  Google Client ID: ");
    if (clientId.length > 0) {
      const secret = await ask("  Google Client Secret: ", true);
      text = setValue(text, "GOOGLE_CLIENT_ID", clientId);
      text = setValue(text, "GOOGLE_CLIENT_SECRET", secret);
      changed.push("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
    }
  }

  // --- generated values ----------------------------------------------------
  if (isPlaceholder(values.get("AUTH_SECRET"))) {
    text = setValue(text, "AUTH_SECRET", randomBytes(32).toString("base64"));
    changed.push("AUTH_SECRET (generated)");
  }
  if (isPlaceholder(values.get("CRON_SECRET"))) {
    text = setValue(text, "CRON_SECRET", randomBytes(24).toString("hex"));
    changed.push("CRON_SECRET (generated)");
  }
  if (isPlaceholder(values.get("APP_PASSWORD"))) {
    const appPassword = await ask("\n  Password to sign in to the app: ", true);
    text = setValue(text, "APP_PASSWORD", appPassword.length > 0 ? appPassword : "pipeline");
    changed.push("APP_PASSWORD");
  }

  if (changed.length === 0) {
    console.log("  Everything was already set. Nothing changed.\n");
    console.log("  Next: npm run db:check\n");
    return;
  }

  await writeFile(ENV_PATH, text);

  console.log(`\n  Wrote ${ENV_PATH}`);
  for (const item of changed) console.log(`    ✓ ${item}`);
  console.log("\n  Next: npm run db:check\n");
}

main().catch((error: unknown) => {
  console.error("\nSetup failed:\n", error);
  process.exit(1);
});
