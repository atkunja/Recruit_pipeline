/**
 * Migration runner: `npm run db:migrate`
 *
 * Applies every unapplied `db/migrations/*.sql` file in filename order, each in
 * its own transaction, recording it in `_migrations`. Re-running is a no-op.
 *
 * Self-contained on purpose — it imports nothing from `src/` so Node can run it
 * directly with native type stripping.
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

function connectionString(): string {
  // DDL over Supabase's transaction pooler is unreliable, so prefer the
  // session-mode URL when one is configured.
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "Missing DIRECT_DATABASE_URL (or DATABASE_URL). See .env.example.",
    );
    process.exit(1);
  }
  return url;
}

async function loadEnvFile(): Promise<void> {
  // Node loads .env only with --env-file; do it manually so `npm run db:migrate`
  // works with no extra flags.
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
      // File absent: try the next candidate.
    }
  }
}

async function main(): Promise<void> {
  await loadEnvFile();

  const sql = postgres(connectionString(), { max: 1, onnotice: () => {} });

  try {
    await sql`
      create table if not exists _migrations (
        name       text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `;

    const applied = await sql<{ name: string; checksum: string }[]>`
      select name, checksum from _migrations
    `;
    const appliedByName = new Map(applied.map((r) => [r.name, r.checksum]));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      const body = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = createHash("sha256").update(body).digest("hex").slice(0, 16);

      const previous = appliedByName.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          // Editing an applied migration silently desyncs environments; refuse.
          console.error(
            `\n  ✗ ${file} was modified after being applied.\n` +
              `    Add a new migration instead of editing this one.\n`,
          );
          process.exitCode = 1;
          return;
        }
        continue;
      }

      process.stdout.write(`  → ${file} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          insert into _migrations (name, checksum) values (${file}, ${checksum})
        `;
      });
      process.stdout.write("ok\n");
      ran += 1;
    }

    console.log(
      ran === 0
        ? `\n  Database up to date (${files.length} migrations applied).\n`
        : `\n  Applied ${ran} migration(s).\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("\nMigration failed:\n", error);
  process.exit(1);
});
