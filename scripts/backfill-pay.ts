/**
 * Extract compensation from stored postings: `npm run db:pay`
 *
 * Runs the parser over every job's structured ATS field and description text.
 * Free — no network, no model — so it is safe to re-run whenever the parser
 * improves.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";
import {
  formatCompensation,
  parseCompensation,
} from "../src/lib/jobs/compensation.ts";

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
      { id: number; description: string | null; compensation: string | null; title: string }[]
    >`
      select id, description, compensation, title
      from jobs
      where description is not null or compensation is not null
    `;

    let found = 0;
    let fromAts = 0;
    let fromText = 0;
    const samples: string[] = [];

    for (const job of jobs) {
      // The ATS field is more trustworthy than prose when present.
      const fromField = parseCompensation(job.compensation);
      const parsed = fromField ?? parseCompensation(job.description);
      if (parsed === null) continue;

      const source = fromField !== null ? "ats" : "text";
      if (source === "ats") fromAts += 1;
      else fromText += 1;
      found += 1;

      await sql`
        update jobs set
          pay_min           = ${parsed.min},
          pay_max           = ${parsed.max},
          pay_period        = ${parsed.period},
          pay_currency      = ${parsed.currency},
          pay_monthly_min   = ${parsed.monthlyMin},
          pay_monthly_max   = ${parsed.monthlyMax},
          pay_raw           = ${parsed.raw},
          pay_source        = ${source},
          pay_period_stated = ${parsed.periodStated},
          updated_at        = now()
        where id = ${job.id}
      `;

      if (samples.length < 12) {
        samples.push(
          `${formatCompensation(parsed).padEnd(18)} ${source.padEnd(5)} ${job.title.slice(0, 52)}`,
        );
      }
    }

    console.log(`\n  Examined ${jobs.length} job(s) with text to parse`);
    console.log(`    compensation found : ${found}`);
    console.log(`      from the ATS field : ${fromAts}`);
    console.log(`      from description   : ${fromText}`);
    console.log(`\n  Samples:`);
    for (const line of samples) console.log(`    ${line}`);

    const top = await sql<{ pay: string; name: string; title: string }[]>`
      select pay_raw as pay, c.name, j.title
      from jobs j join companies c on c.id = j.company_id
      where j.pay_monthly_max is not null and j.canonical_job_id is null
      order by j.pay_monthly_max desc
      limit 8
    `;
    console.log(`\n  Highest paying:`);
    for (const row of top) {
      console.log(`    ${String(row.pay).padEnd(22)} ${String(row.name).padEnd(20)} ${String(row.title).slice(0, 44)}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("\nBackfill failed:\n", error);
  process.exit(1);
});
