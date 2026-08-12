/**
 * Re-run the deterministic prefilter over every stored job: `npm run db:refilter`
 *
 * The prefilter is pure and free, so when its rules change the existing corpus
 * should be re-evaluated rather than left with stale verdicts. Jobs wrongly
 * rejected by an old rule become visible again; nothing is re-fetched and no
 * model is called.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";
import { prefilter } from "../src/lib/jobs/prefilter.ts";

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
    max: 1,
    prepare: false,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      bigint: { to: 20, from: [20], serialize: (v: number | string) => String(v), parse: (v: string) => Number(v) },
    },
  });

  try {
    const profileRows = await sql<{ target_season: string; graduation_date: Date }[]>`
      select target_season, graduation_date from profile where id = 1
    `;
    const profile = profileRows[0];
    if (!profile) throw new Error("No profile row. Run npm run db:seed.");

    const jobs = await sql<
      {
        id: number;
        title: string;
        description: string | null;
        location_raw: string | null;
        locations: string[];
        season: string | null;
        is_active: boolean;
        closed_at: Date | null;
        prefilter: string;
      }[]
    >`
      select id, title, description, location_raw, locations, season,
             is_active, closed_at, prefilter::text as prefilter
      from jobs
    `;

    let changed = 0;
    let nowPass = 0;
    let nowReject = 0;

    for (const job of jobs) {
      const verdict = prefilter(
        {
          title: job.title,
          description: job.description,
          locationRaw: job.location_raw,
          locations: job.locations,
          season: job.season,
          isActive: job.is_active,
          closedAt: job.closed_at,
        },
        {
          targetSeason: profile.target_season,
          graduationDate: new Date(profile.graduation_date),
        },
      );

      if (verdict.verdict === job.prefilter) continue;

      await sql`
        update jobs
        set prefilter = ${verdict.verdict}, prefilter_reasons = ${verdict.reasons},
            updated_at = now()
        where id = ${job.id}
      `;
      changed += 1;
      if (verdict.verdict === "pass") nowPass += 1;
      else nowReject += 1;
    }

    console.log(`\n  Re-filtered ${jobs.length} job(s)`);
    console.log(`    changed verdict : ${changed}`);
    console.log(`    newly passing   : ${nowPass}`);
    console.log(`    newly rejected  : ${nowReject}`);

    const totals = await sql<{ prefilter: string; n: number }[]>`
      select prefilter::text as prefilter, count(*)::int as n from jobs group by 1 order by n desc
    `;
    console.log(`\n  Current totals:`);
    for (const row of totals) console.log(`    ${row.prefilter.padEnd(8)} ${row.n}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("\nRefilter failed:\n", error);
  process.exit(1);
});
