import "server-only";
import { sql } from "../db";
import { ingestJob } from "../jobs/ingest";
import { fetchPosting } from "../jobs/fetch-posting";
import { hashText, extractSections } from "../jobs/normalize";
import { prefilter } from "../jobs/prefilter";
import { getAdapter, isTitleInteresting } from "../sources/registry";
import { loadProfileContext } from "../profile/context";
import { scoreJob } from "../scoring/score";
import { listUnscoredJobs } from "../jobs/repository";
import { getScoringWeights } from "../settings";
import { weightsHash } from "../scoring/weights";
import { budgetStatus } from "../ai/budget";
import type { JobSource, Profile } from "../types";

/**
 * The scheduled discovery run.
 *
 * Ordering matters, and it is all about cost:
 *   1. adapters apply a loose title screen while parsing (free)
 *   2. ingest normalizes, dedupes and runs the real prefilter (free)
 *   3. survivors missing a description get one fetched (cheap, bounded)
 *   4. only then does anything reach the model (the only thing we pay for)
 *
 * A run is bounded at every step so a cron invocation finishes inside its
 * timeout and cannot produce a surprise bill.
 */

export interface DiscoverOptions {
  /** Only run these source ids. Omit to run every enabled source. */
  sourceIds?: number[];
  /** Max sources per run. */
  maxSources?: number;
  /** Max descriptions to backfill per run. */
  maxEnrichments?: number;
  /** Max jobs to score per run. The only step that costs money. */
  maxScored?: number;
  signal?: AbortSignal;
}

export interface DiscoverResult {
  sourcesRun: number;
  sourcesFailed: number;
  postingsSeen: number;
  jobsNew: number;
  jobsUpdated: number;
  jobsDuplicate: number;
  passedPrefilter: number;
  enriched: number;
  scored: number;
  scoreErrors: number;
  budgetStopped: boolean;
  errors: { source: string; error: string }[];
}

export async function runDiscovery(
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const {
    maxSources = 60,
    maxEnrichments = 60,
    maxScored = 40,
    signal = new AbortController().signal,
  } = options;

  const result: DiscoverResult = {
    sourcesRun: 0,
    sourcesFailed: 0,
    postingsSeen: 0,
    jobsNew: 0,
    jobsUpdated: 0,
    jobsDuplicate: 0,
    passedPrefilter: 0,
    enriched: 0,
    scored: 0,
    scoreErrors: 0,
    budgetStopped: false,
    errors: [],
  };

  const { profile } = await loadProfileContext();
  const sources = await selectSources(options.sourceIds, maxSources);

  for (const source of sources) {
    if (signal.aborted) break;
    const outcome = await runSource(source, profile, signal);

    result.sourcesRun += 1;
    result.postingsSeen += outcome.seen;
    result.jobsNew += outcome.created;
    result.jobsUpdated += outcome.updated;
    result.jobsDuplicate += outcome.duplicates;

    if (outcome.error !== null) {
      result.sourcesFailed += 1;
      result.errors.push({ source: source.name, error: outcome.error });
    }
  }

  result.enriched = await enrichDescriptions(profile, maxEnrichments, signal);

  const scoring = await scorePending(maxScored, signal);
  result.scored = scoring.scored;
  result.scoreErrors = scoring.errors;
  result.budgetStopped = scoring.budgetStopped;

  result.passedPrefilter = await countPassing();

  return result;
}

/** Enabled sources, least recently run first so every board gets a turn. */
async function selectSources(
  sourceIds: number[] | undefined,
  limit: number,
): Promise<JobSource[]> {
  if (sourceIds !== undefined && sourceIds.length > 0) {
    return sql<JobSource[]>`
      select * from job_sources where id = any(${sourceIds})
    `;
  }

  return sql<JobSource[]>`
    select * from job_sources
    where enabled
      -- Back off a board that keeps failing rather than hammering it.
      and (consecutive_failures < 5 or last_run_at < now() - interval '1 day')
    order by priority desc, last_run_at asc nulls first
    limit ${limit}
  `;
}

interface SourceOutcome {
  seen: number;
  created: number;
  updated: number;
  duplicates: number;
  error: string | null;
}

async function runSource(
  source: JobSource,
  profile: Pick<Profile, "targetSeason" | "graduationDate">,
  signal: AbortSignal,
): Promise<SourceOutcome> {
  const outcome: SourceOutcome = {
    seen: 0,
    created: 0,
    updated: 0,
    duplicates: 0,
    error: null,
  };

  const runs = await sql<{ id: number }[]>`
    insert into discovery_runs (source_id) values (${source.id}) returning id
  `;
  const runId = runs[0]?.id ?? null;

  const adapter = getAdapter(source.kind);
  if (adapter === null) {
    outcome.error = `No adapter registered for "${source.kind}"`;
    await finishRun(runId, source, outcome);
    return outcome;
  }

  try {
    const postings = await adapter.fetch(source.config, {
      isTitleInteresting,
      signal,
    });
    outcome.seen = postings.length;

    for (const posting of postings) {
      if (signal.aborted) break;
      try {
        const ingested = await ingestJob(
          {
            companyName: posting.companyName,
            companyWebsite: posting.companyWebsite,
            companyCategory: posting.companyCategory,
            title: posting.title,
            url: posting.url,
            sourceKind: adapter.kind,
            sourceId: source.id,
            sourceJobId: posting.sourceJobId,
            locationRaw: posting.locationRaw,
            description: posting.description,
            compensation: posting.compensation,
            postedAt: posting.postedAt,
            raw: posting.raw,
          },
          profile,
        );

        if (ingested.isDuplicate) outcome.duplicates += 1;
        else if (ingested.isNew) outcome.created += 1;
        else if (ingested.isUpdated) outcome.updated += 1;
      } catch (error) {
        // One malformed posting must not abandon the rest of the board.
        console.error(
          `[discover] ${source.name}: failed to ingest ${posting.url}`,
          error,
        );
      }
    }
  } catch (error) {
    outcome.error = error instanceof Error ? error.message : String(error);
  }

  await finishRun(runId, source, outcome);
  return outcome;
}

async function finishRun(
  runId: number | null,
  source: JobSource,
  outcome: SourceOutcome,
): Promise<void> {
  const status = outcome.error === null ? "ok" : "error";

  if (runId !== null) {
    await sql`
      update discovery_runs set
        finished_at    = now(),
        status         = ${status},
        jobs_seen      = ${outcome.seen},
        jobs_new       = ${outcome.created},
        jobs_updated   = ${outcome.updated},
        jobs_duplicate = ${outcome.duplicates},
        error          = ${outcome.error}
      where id = ${runId}
    `;
  }

  await sql`
    update job_sources set
      last_run_at = now(),
      last_status = ${status},
      last_error  = ${outcome.error},
      consecutive_failures = ${
        outcome.error === null ? 0 : source.consecutiveFailures + 1
      },
      updated_at = now()
    where id = ${source.id}
  `;
}

/**
 * Fetch descriptions for prefilter survivors that arrived without one.
 *
 * Curated feeds (Simplify) list thousands of roles with no body text. Fetching
 * only the ones that already passed the title/season/location filter keeps this
 * to tens of requests instead of thousands.
 */
async function enrichDescriptions(
  profile: Pick<Profile, "targetSeason" | "graduationDate">,
  limit: number,
  signal: AbortSignal,
): Promise<number> {
  const jobs = await sql<
    {
      id: number;
      url: string;
      title: string;
      locationRaw: string | null;
      locations: string[];
      season: string | null;
    }[]
  >`
    select id, url, title, location_raw, locations, season
    from jobs
    where is_active
      and not is_ignored
      and canonical_job_id is null
      and description is null
      and prefilter <> 'reject'
    order by discovered_at desc
    limit ${limit}
  `;

  let enriched = 0;

  for (const job of jobs) {
    if (signal.aborted) break;
    try {
      const fetched = await fetchPosting(job.url);
      const description = fetched.description;
      if (description === null || description.length < 120) continue;

      const sections = extractSections(description);

      // With real text in hand, re-run the prefilter — a description often
      // reveals a wrong season or an experience requirement the title hid.
      const verdict = prefilter(
        {
          title: job.title,
          description,
          locationRaw: job.locationRaw,
          locations: job.locations,
          season: job.season,
          isActive: true,
          closedAt: null,
        },
        {
          targetSeason: profile.targetSeason,
          graduationDate: profile.graduationDate,
        },
      );

      await sql`
        update jobs set
          description = ${description},
          requirements = ${sections.requirements},
          preferred_qualifications = ${sections.preferred},
          description_hash = ${hashText(description)},
          prefilter = ${verdict.verdict},
          prefilter_reasons = ${verdict.reasons},
          updated_at = now()
        where id = ${job.id}
      `;
      enriched += 1;
    } catch {
      // A blocked or dead posting page is not worth retrying this run; the
      // job stays scoreable on its title alone.
    }
  }

  return enriched;
}

/** Score jobs that passed the prefilter and have no score for these weights. */
async function scorePending(
  limit: number,
  signal: AbortSignal,
): Promise<{ scored: number; errors: number; budgetStopped: boolean }> {
  const budget = await budgetStatus();
  if (!budget.unlimited && budget.remaining <= 0) {
    return { scored: 0, errors: 0, budgetStopped: true };
  }

  const [context, weights] = await Promise.all([
    loadProfileContext(),
    getScoringWeights(),
  ]);

  const pending = await listUnscoredJobs(weightsHash(weights), limit);

  let scored = 0;
  let errors = 0;

  for (const job of pending) {
    if (signal.aborted) break;
    try {
      await scoreJob({
        job,
        companyName: job.companyName,
        companyPreference: job.companyPreference,
        context,
        weights,
      });
      scored += 1;
    } catch (error) {
      if (error instanceof Error && error.name === "BudgetExceededError") {
        return { scored, errors, budgetStopped: true };
      }
      errors += 1;
      console.error(`[discover] failed to score job ${job.id}`, error);
    }
  }

  return { scored, errors, budgetStopped: false };
}

async function countPassing(): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from jobs
    where is_active and not is_ignored
      and canonical_job_id is null and prefilter = 'pass'
  `;
  return Number(rows[0]?.count ?? 0);
}
