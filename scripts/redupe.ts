/**
 * Recompute dedupe keys and re-link duplicates: `npm run db:redupe`
 *
 * The dedupe key is derived, so when its derivation changes the stored keys go
 * stale and duplicates that should now collapse stay visible. This recomputes
 * every key from the company slug, title and location, then relinks each group
 * so the earliest-discovered posting is canonical and the rest point at it.
 *
 * Free — no network, no model.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";
import { buildDedupeKey, parseLocations } from "../src/lib/jobs/normalize.ts";

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
      // next candidate
    }
  }
}

async function main(): Promise<void> {
  await loadEnv();
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Missing DATABASE_URL.");
    process.exit(1);
  }

  const sql = postgres(url, {
    max: 4,
    prepare: false,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      bigint: { to: 20, from: [20], serialize: (v: number | string) => String(v), parse: (v: string) => Number(v) },
    },
  });

  try {
    const jobs = await sql<
      {
        id: number;
        title: string;
        location_raw: string | null;
        locations: string[];
        dedupe_key: string;
        slug: string;
        discovered_at: Date;
      }[]
    >`
      select j.id, j.title, j.location_raw, j.locations, j.dedupe_key,
             c.slug, j.discovered_at
      from jobs j join companies c on c.id = j.company_id
      order by j.discovered_at asc
    `;

    // 1. Recompute keys.
    let rekeyed = 0;
    const groups = new Map<string, number[]>();

    for (const job of jobs) {
      const locations =
        job.locations.length > 0 ? job.locations : parseLocations(job.location_raw);
      const key = buildDedupeKey(job.slug, job.title, locations[0] ?? null);

      if (key !== job.dedupe_key) {
        await sql`update jobs set dedupe_key = ${key} where id = ${job.id}`;
        rekeyed += 1;
      }

      const group = groups.get(key) ?? [];
      group.push(job.id);
      groups.set(key, group);
    }

    // 2. Relink each group: earliest discovered wins, the rest point at it.
    let canonical = 0;
    let linked = 0;

    for (const ids of groups.values()) {
      const [first, ...rest] = ids;
      if (first === undefined) continue;

      await sql`update jobs set canonical_job_id = null where id = ${first}`;
      canonical += 1;

      if (rest.length === 0) continue;
      await sql`
        update jobs set canonical_job_id = ${first}, updated_at = now()
        where id = any(${rest})
      `;
      linked += rest.length;
    }

    console.log(`\n  Examined ${jobs.length} job(s)`);
    console.log(`    keys recomputed  : ${rekeyed}`);
    console.log(`    canonical groups : ${canonical}`);
    console.log(`    linked duplicates: ${linked}`);

    const visible = await sql<{ n: number }[]>`
      select count(*)::int as n from jobs
      where canonical_job_id is null and is_active and not is_ignored
    `;
    console.log(`\n  Visible after dedupe: ${visible[0]?.n ?? 0}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("\nRedupe failed:\n", error);
  process.exit(1);
});
