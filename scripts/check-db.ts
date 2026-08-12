/**
 * Connection check: `npm run db:check`
 *
 * Verifies both database URLs before you try to migrate, and turns the usual
 * failures into a specific instruction instead of a driver stack trace.
 *
 * Self-contained so Node runs it directly.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

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
      console.log(`  Loaded ${file}\n`);
      return;
    } catch {
      // Try the next candidate.
    }
  }
  console.log("  No .env.local found — reading the process environment.\n");
}

interface Check {
  label: string;
  variable: string;
  expectedPort: string;
  purpose: string;
}

const CHECKS: Check[] = [
  {
    label: "Session pooler",
    variable: "DATABASE_URL",
    expectedPort: "5432",
    purpose: "the app's queries",
  },
  {
    label: "Session pooler",
    variable: "DIRECT_DATABASE_URL",
    expectedPort: "5432",
    purpose: "migrations",
  },
];

/** Turn a driver error into something you can act on. */
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code ?? "";

  if (code === "ENOTFOUND" || /getaddrinfo/i.test(message)) {
    return "Host not found. Check the hostname — it should end in .pooler.supabase.com";
  }
  if (code === "ENETUNREACH" || /ENETUNREACH/i.test(message)) {
    return (
      "Network unreachable. This is the IPv6 problem: you are using the " +
      "'Direct connection' string (db.<ref>.supabase.co). Use the Session " +
      "pooler string instead (aws-0-<region>.pooler.supabase.com:5432)."
    );
  }
  if (/password authentication failed|SASL|SCRAM/i.test(message)) {
    return (
      "Password rejected. If your password contains @ : / # ? or &, it must be " +
      "percent-encoded in the URL (@ becomes %40). Resetting to an " +
      "alphanumeric password in Supabase avoids this entirely."
    );
  }
  if (/Tenant or user not found/i.test(message)) {
    return (
      "Supabase did not recognise the user. The pooler username must be " +
      "postgres.<project-ref>, not plain 'postgres'. Copy the whole string " +
      "from the dashboard rather than editing it by hand."
    );
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(message)) {
    return "Timed out. Check the port, and whether a VPN or firewall is in the way.";
  }
  return message;
}

async function check(item: Check): Promise<boolean> {
  const url = process.env[item.variable];

  if (!url || url.includes("<ref>")) {
    console.log(`  ✗ ${item.variable} is not set (needed for ${item.purpose})`);
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.log(`  ✗ ${item.variable} is not a valid URL`);
    return false;
  }

  if (parsed.port !== item.expectedPort) {
    console.log(
      `  ⚠ ${item.variable} uses port ${parsed.port}, expected ${item.expectedPort} ` +
        `(${item.label})`,
    );
  }
  if (parsed.hostname.startsWith("db.") && parsed.hostname.endsWith("supabase.co")) {
    console.log(
      `  ⚠ ${item.variable} is the IPv6-only Direct connection. Prefer the ` +
        `${item.label} string from the dashboard.`,
    );
  }

  const sql = postgres(url, {
    max: 1,
    connect_timeout: 15,
    prepare: false,
    onnotice: () => {},
  });

  try {
    const rows = await sql<{ version: string; db: string }[]>`
      select version() as version, current_database() as db
    `;
    const version = rows[0]?.version.split(" ").slice(0, 2).join(" ") ?? "unknown";
    console.log(`  ✓ ${item.variable} → ${version}, database "${rows[0]?.db}"`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${item.variable} failed`);
    console.log(`      ${explain(error)}`);
    return false;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log("\n  Checking database connections\n");
  await loadEnvFile();

  const results: boolean[] = [];
  for (const item of CHECKS) results.push(await check(item));

  const ok = results.every(Boolean);
  console.log(
    ok
      ? "\n  Both connections work. Next: npm run db:migrate\n"
      : "\n  Fix the above, then re-run: npm run db:check\n",
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error("\nCheck failed:\n", error);
  process.exit(1);
});
