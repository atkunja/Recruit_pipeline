import "server-only";
import { json, sql } from "../db";
import { logActivity } from "../activity";
import { prefilter } from "./prefilter";
import { parseCompensation } from "./compensation";
import { upsertCompany } from "./repository";
import {
  buildDedupeKey,
  detectRemote,
  detectSeason,
  extractSections,
  hashText,
  normalizeTitle,
  parseLocations,
} from "./normalize";
import type { CompanyCategory, Job, Profile, SourceKind } from "../types";

/**
 * The single ingestion path.
 *
 * Every adapter and the manual paste form funnel through `ingestJob`, so
 * normalization, prefiltering and duplicate detection happen exactly once and
 * in exactly one place.
 */

export interface NormalizedJobInput {
  companyName: string;
  companyWebsite?: string | null;
  companyCategory?: CompanyCategory;

  title: string;
  url: string;
  sourceKind: SourceKind;
  sourceJobId?: string | null;
  sourceId?: number | null;

  locationRaw?: string | null;
  description?: string | null;
  compensation?: string | null;
  postedAt?: Date | null;
  season?: string | null;

  raw?: unknown;
}

export interface IngestResult {
  job: Job;
  /** True the first time we have ever seen this posting. */
  isNew: boolean;
  /** True when this row was linked to an existing canonical posting. */
  isDuplicate: boolean;
  /** True when the description changed since we last saw it. */
  isUpdated: boolean;
}

export async function ingestJob(
  input: NormalizedJobInput,
  profile: Pick<Profile, "targetSeason" | "graduationDate">,
): Promise<IngestResult> {
  const company = await upsertCompany({
    name: input.companyName,
    website: input.companyWebsite ?? null,
    category: input.companyCategory,
    atsKind: input.sourceKind,
  });

  const description = input.description ?? null;
  const locations = parseLocations(input.locationRaw);
  const isRemote = detectRemote(input.locationRaw);
  const season = input.season ?? detectSeason(input.title, description);
  const normalizedTitle = normalizeTitle(input.title);
  const descriptionHash = hashText(description ?? input.title);
  const dedupeKey = buildDedupeKey(
    company.slug,
    input.title,
    locations[0] ?? null,
  );

  const sections = description
    ? extractSections(description)
    : { requirements: null, preferred: null };

  // Pay-transparency laws mean most US postings state a range in the body, so
  // the description is usually a better source than the ATS field — but the
  // structured field, when present, is unambiguous, so it wins.
  const pay =
    parseCompensation(input.compensation) ?? parseCompensation(description);
  const paySource = pay === null ? null : parseCompensation(input.compensation) !== null ? "ats" : "text";

  // Applying twice to one posting is the mistake this system exists to prevent,
  // so the check runs before the row is even written.
  const alreadyApplied = await hasApplicationForDedupeKey(dedupeKey);

  const verdict = prefilter(
    {
      title: input.title,
      description,
      locationRaw: input.locationRaw ?? null,
      locations,
      season,
      isActive: true,
      closedAt: null,
      alreadyApplied,
    },
    {
      targetSeason: profile.targetSeason,
      graduationDate: profile.graduationDate,
    },
  );

  const existing = await findExisting(
    input.sourceKind,
    input.sourceJobId ?? null,
    input.url,
  );

  const rows = await sql<Job[]>`
    insert into jobs (
      company_id, source_kind, source_id, source_job_id, title, normalized_title,
      url, location_raw, locations, is_remote, description, requirements,
      preferred_qualifications, compensation, season, posted_at,
      description_hash, dedupe_key, prefilter, prefilter_reasons, raw,
      pay_min, pay_max, pay_period, pay_currency, pay_monthly_min,
      pay_monthly_max, pay_raw, pay_source, pay_period_stated
    ) values (
      ${company.id}, ${input.sourceKind}, ${input.sourceId ?? null},
      ${input.sourceJobId ?? null}, ${input.title}, ${normalizedTitle},
      ${input.url}, ${input.locationRaw ?? null}, ${locations}, ${isRemote},
      ${description}, ${sections.requirements}, ${sections.preferred},
      ${input.compensation ?? null}, ${season}, ${input.postedAt ?? null},
      ${descriptionHash}, ${dedupeKey}, ${verdict.verdict},
      ${verdict.reasons}, ${input.raw === undefined ? null : sql.json(json(input.raw))},
      ${pay?.min ?? null}, ${pay?.max ?? null}, ${pay?.period ?? null},
      ${pay?.currency ?? null}, ${pay?.monthlyMin ?? null},
      ${pay?.monthlyMax ?? null}, ${pay?.raw ?? null}, ${paySource},
      ${pay?.periodStated ?? false}
    )
    on conflict (url) do update set
      title            = excluded.title,
      normalized_title = excluded.normalized_title,
      location_raw     = excluded.location_raw,
      locations        = excluded.locations,
      is_remote        = excluded.is_remote,
      -- Keep the description we already have if the adapter didn't fetch one;
      -- list endpoints often omit it while detail endpoints include it.
      description      = coalesce(excluded.description, jobs.description),
      requirements     = coalesce(excluded.requirements, jobs.requirements),
      preferred_qualifications =
        coalesce(excluded.preferred_qualifications, jobs.preferred_qualifications),
      compensation     = coalesce(excluded.compensation, jobs.compensation),
      season           = coalesce(excluded.season, jobs.season),
      posted_at        = coalesce(excluded.posted_at, jobs.posted_at),
      description_hash = case
        when excluded.description is not null then excluded.description_hash
        else jobs.description_hash
      end,
      prefilter         = excluded.prefilter,
      prefilter_reasons = excluded.prefilter_reasons,
      -- Keep a figure we already have if this run didn't find one.
      pay_min           = coalesce(excluded.pay_min, jobs.pay_min),
      pay_max           = coalesce(excluded.pay_max, jobs.pay_max),
      pay_period        = coalesce(excluded.pay_period, jobs.pay_period),
      pay_currency      = coalesce(excluded.pay_currency, jobs.pay_currency),
      pay_monthly_min   = coalesce(excluded.pay_monthly_min, jobs.pay_monthly_min),
      pay_monthly_max   = coalesce(excluded.pay_monthly_max, jobs.pay_monthly_max),
      pay_raw           = coalesce(excluded.pay_raw, jobs.pay_raw),
      pay_source        = coalesce(excluded.pay_source, jobs.pay_source),
      pay_period_stated = excluded.pay_period_stated or jobs.pay_period_stated,
      is_active         = true,
      updated_at        = now()
    returning *
  `;

  const job = rows[0];
  if (!job) throw new Error(`Failed to ingest job ${input.url}`);

  const isNew = existing === null;
  const isUpdated =
    existing !== null && existing.descriptionHash !== job.descriptionHash;

  const isDuplicate = await linkDuplicate(job);

  if (isNew && !isDuplicate) {
    await logActivity({
      kind: "job_discovered",
      message: `Discovered ${job.title} at ${company.name}`,
      jobId: job.id,
      companyId: company.id,
      meta: { source: input.sourceKind, prefilter: verdict.verdict },
    });
  }

  return { job, isNew, isDuplicate, isUpdated };
}

async function findExisting(
  sourceKind: SourceKind,
  sourceJobId: string | null,
  url: string,
): Promise<Job | null> {
  if (sourceJobId !== null) {
    const bySource = await sql<Job[]>`
      select * from jobs
      where source_kind = ${sourceKind} and source_job_id = ${sourceJobId}
      limit 1
    `;
    if (bySource[0]) return bySource[0];
  }
  const byUrl = await sql<Job[]>`select * from jobs where url = ${url} limit 1`;
  return byUrl[0] ?? null;
}

/**
 * Point this row at the earliest posting sharing its dedupe key.
 *
 * The oldest row wins so the canonical listing is the one we have the longest
 * history for. Returns true when this row became a duplicate.
 */
async function linkDuplicate(job: Job): Promise<boolean> {
  const siblings = await sql<{ id: number }[]>`
    select id from jobs
    where dedupe_key = ${job.dedupeKey}
      and id <> ${job.id}
      and canonical_job_id is null
      and is_active
    order by discovered_at asc
    limit 1
  `;

  const canonical = siblings[0];
  if (!canonical) {
    // This row may itself be the canonical one; make sure it isn't pointing
    // at something stale from a previous run.
    if (job.canonicalJobId !== null) {
      await sql`update jobs set canonical_job_id = null where id = ${job.id}`;
    }
    return false;
  }

  // Whichever was discovered first stays canonical.
  if (canonical.id === job.id) return false;

  await sql`
    update jobs
    set canonical_job_id = ${canonical.id}, updated_at = now()
    where id = ${job.id}
  `;
  return true;
}

/** True when any job sharing this dedupe key already has an application. */
async function hasApplicationForDedupeKey(dedupeKey: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select exists (
      select 1
      from applications a
      join jobs j on j.id = a.job_id
      where j.dedupe_key = ${dedupeKey}
        and a.status not in ('withdrawn', 'rejected')
    ) as exists
  `;
  return rows[0]?.exists ?? false;
}
