import "server-only";
import { sql } from "../db";
import { slugifyCompany } from "./normalize";
import type {
  ApplicationStatus,
  Company,
  CompanyCategory,
  Job,
  JobListItem,
  SourceKind,
} from "../types";

/** Database access for companies and jobs. */

export interface UpsertCompanyInput {
  name: string;
  website?: string | null;
  category?: CompanyCategory;
  atsKind?: SourceKind | null;
  atsSlug?: string | null;
}

/**
 * Find or create a company by its slug.
 *
 * Only fills in blanks on an existing row — a category the user set by hand
 * must not be overwritten by whatever an adapter guessed.
 */
export async function upsertCompany(input: UpsertCompanyInput): Promise<Company> {
  const slug = slugifyCompany(input.name);

  const rows = await sql<Company[]>`
    insert into companies (name, slug, website, category, ats_kind, ats_slug)
    values (
      ${input.name}, ${slug}, ${input.website ?? null},
      ${input.category ?? "other"}, ${input.atsKind ?? null}, ${input.atsSlug ?? null}
    )
    on conflict (slug) do update set
      website  = coalesce(companies.website, excluded.website),
      ats_kind = coalesce(companies.ats_kind, excluded.ats_kind),
      ats_slug = coalesce(companies.ats_slug, excluded.ats_slug),
      updated_at = now()
    returning *
  `;

  const company = rows[0];
  if (!company) throw new Error(`Failed to upsert company ${input.name}`);
  return company;
}

export interface DiscoverFilters {
  minScore?: number | null;
  companyId?: number | null;
  search?: string | null;
  location?: string | null;
  /** ISO date; only jobs discovered on or after it. */
  discoveredSince?: string | null;
  status?: ApplicationStatus | "none" | null;
  includeIgnored?: boolean;
  includeScored?: "all" | "scored" | "unscored";
  sort?: "score" | "discovered" | "posted";
  limit?: number;
  offset?: number;
}

/**
 * The Discover feed.
 *
 * Duplicates are collapsed: rows carrying a `canonical_job_id` are excluded and
 * the surviving row reports how many other boards also listed it.
 */
export async function listDiscoverJobs(
  filters: DiscoverFilters = {},
): Promise<JobListItem[]> {
  const {
    minScore = null,
    companyId = null,
    search = null,
    location = null,
    discoveredSince = null,
    status = null,
    includeIgnored = false,
    includeScored = "all",
    sort = "score",
    limit = 100,
    offset = 0,
  } = filters;

  return sql<JobListItem[]>`
    select
      j.id,
      j.title,
      j.url,
      j.location_raw,
      j.is_remote,
      j.season,
      j.posted_at,
      j.discovered_at,
      j.source_kind,
      j.is_ignored,
      c.id            as company_id,
      c.name          as company_name,
      c.category      as company_category,
      c.preference    as company_preference,
      s.total         as score,
      s.summary       as score_summary,
      s.components    as components,
      coalesce(s.strongest_skills, '{}')      as strongest_skills,
      coalesce(s.missing_requirements, '{}')  as missing_requirements,
      a.id            as application_id,
      a.status        as application_status,
      (
        select count(*)::int from jobs d where d.canonical_job_id = j.id
      )               as duplicate_count
    from jobs j
    join companies c on c.id = j.company_id
    left join lateral (
      select * from job_scores js
      where js.job_id = j.id
      order by js.created_at desc
      limit 1
    ) s on true
    left join applications a on a.job_id = j.id
    where j.is_active
      and j.canonical_job_id is null
      and (${includeIgnored} or not j.is_ignored)
      and (${minScore}::int is null or s.total >= ${minScore})
      and (${companyId}::bigint is null or c.id = ${companyId})
      and (
        ${search}::text is null
        or j.title ilike ${"%" + (search ?? "") + "%"}
        or c.name ilike ${"%" + (search ?? "") + "%"}
      )
      and (
        ${location}::text is null
        or j.location_raw ilike ${"%" + (location ?? "") + "%"}
      )
      and (${discoveredSince}::timestamptz is null or j.discovered_at >= ${discoveredSince})
      and (
        ${status}::text is null
        or (${status} = 'none' and a.id is null)
        or a.status::text = ${status}
      )
      and (
        ${includeScored} = 'all'
        or (${includeScored} = 'scored' and s.total is not null)
        or (${includeScored} = 'unscored' and s.total is null)
      )
    order by
      case when ${sort} = 'score' then s.total end desc nulls last,
      case when ${sort} = 'posted' then j.posted_at end desc nulls last,
      j.discovered_at desc
    limit ${limit} offset ${offset}
  `;
}

/** Jobs that passed the prefilter but have no score for the current weights. */
export async function listUnscoredJobs(
  weightsHash: string,
  limit = 40,
): Promise<
  (Job & { companyName: string; companyPreference: number })[]
> {
  return sql<(Job & { companyName: string; companyPreference: number })[]>`
    select j.*, c.name as company_name, c.preference as company_preference
    from jobs j
    join companies c on c.id = j.company_id
    where j.is_active
      and not j.is_ignored
      and j.canonical_job_id is null
      and j.prefilter = 'pass'
      and not exists (
        select 1 from job_scores s
        where s.job_id = j.id
          and s.weights_hash = ${weightsHash}
          and s.description_hash = coalesce(j.description_hash, '')
      )
    order by j.discovered_at desc
    limit ${limit}
  `;
}

/** A single job with everything the detail view renders. */
export async function getJobDetail(jobId: number): Promise<
  | (Job & {
      companyName: string;
      companySlug: string;
      companyCategory: CompanyCategory;
      companyPreference: number;
      companyWebsite: string | null;
    })
  | null
> {
  const rows = await sql<
    (Job & {
      companyName: string;
      companySlug: string;
      companyCategory: CompanyCategory;
      companyPreference: number;
      companyWebsite: string | null;
    })[]
  >`
    select
      j.*,
      c.name     as company_name,
      c.slug     as company_slug,
      c.category as company_category,
      c.preference as company_preference,
      c.website  as company_website
    from jobs j
    join companies c on c.id = j.company_id
    where j.id = ${jobId}
  `;
  return rows[0] ?? null;
}

/** Other boards that listed the same posting. */
export async function getDuplicates(jobId: number): Promise<
  Pick<Job, "id" | "url" | "sourceKind" | "discoveredAt">[]
> {
  return sql<Pick<Job, "id" | "url" | "sourceKind" | "discoveredAt">[]>`
    select id, url, source_kind, discovered_at
    from jobs
    where canonical_job_id = ${jobId}
    order by discovered_at asc
  `;
}

export async function setJobIgnored(
  jobId: number,
  ignored: boolean,
  reason: string | null = null,
): Promise<void> {
  await sql`
    update jobs
    set is_ignored = ${ignored},
        ignored_reason = ${ignored ? reason : null},
        updated_at = now()
    where id = ${jobId}
  `;
}

/** Count of jobs discovered since a timestamp, for the dashboard header. */
export async function countDiscoveredSince(since: Date): Promise<{
  total: number;
  highFit: number;
}> {
  const rows = await sql<{ total: string; highFit: string }[]>`
    select
      count(*)::text as total,
      count(*) filter (where s.total >= 90)::text as "highFit"
    from jobs j
    left join lateral (
      select total from job_scores js
      where js.job_id = j.id
      order by js.created_at desc
      limit 1
    ) s on true
    where j.discovered_at >= ${since}
      and j.canonical_job_id is null
      and not j.is_ignored
      and j.is_active
  `;
  return {
    total: Number(rows[0]?.total ?? 0),
    highFit: Number(rows[0]?.highFit ?? 0),
  };
}
