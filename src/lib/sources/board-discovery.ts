import "server-only";
import { json, sql } from "../db";
import { slugifyCompany } from "../jobs/normalize";
import type { CompanyCategory, SourceKind } from "../types";

/**
 * Finds which ATS a company posts on, and registers it as a discovery source.
 *
 * This is how the system reaches beyond famous companies: given a list of
 * company names (YC's public directory, say), probe the three ATS APIs for a
 * board matching the company's slug. A hit becomes a `job_sources` row and is
 * polled from then on like any other board.
 *
 * Every probe is recorded, so runs are incremental — a company checked recently
 * is skipped, and one with no board is not re-checked for a month.
 */

export interface CompanyCandidate {
  /** Stable external id, e.g. "yc:airbnb". */
  externalKey: string;
  name: string;
  website?: string | null;
  /** Extra slugs worth trying beyond the ones derived from the name. */
  slugHints?: string[];
  category?: CompanyCategory;
}

export interface ProbeOutcome {
  candidate: CompanyCandidate;
  found: { kind: SourceKind; slug: string; jobCount: number } | null;
  error?: string;
}

export interface DiscoverBoardsResult {
  probed: number;
  found: number;
  skipped: number;
  registered: number;
}

/** Re-probe a company that had no board only after this long. */
const NOT_FOUND_COOLDOWN_DAYS = 30;

const PROBERS: {
  kind: SourceKind;
  url: (slug: string) => string;
  count: (payload: unknown) => number | null;
}[] = [
  {
    kind: "greenhouse",
    url: (slug) =>
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
    count: (payload) => {
      const jobs = (payload as { jobs?: unknown[] } | null)?.jobs;
      return Array.isArray(jobs) ? jobs.length : null;
    },
  },
  {
    kind: "lever",
    url: (slug) =>
      `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
    count: (payload) => (Array.isArray(payload) ? payload.length : null),
  },
  {
    kind: "ashby",
    url: (slug) =>
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
    count: (payload) => {
      const jobs = (payload as { jobs?: unknown[] } | null)?.jobs;
      return Array.isArray(jobs) ? jobs.length : null;
    },
  },
];

/**
 * Probe a batch of companies and register whatever boards turn up.
 * `limit` bounds the run so a cron invocation stays well inside its timeout.
 */
export async function discoverBoards(
  candidates: CompanyCandidate[],
  options: { limit?: number; concurrency?: number; signal?: AbortSignal } = {},
): Promise<DiscoverBoardsResult> {
  const limit = options.limit ?? 120;
  const concurrency = options.concurrency ?? 5;
  const signal = options.signal ?? new AbortController().signal;

  const pending = await filterAlreadyProbed(candidates);
  const batch = pending.slice(0, limit);

  const result: DiscoverBoardsResult = {
    probed: 0,
    found: 0,
    skipped: candidates.length - pending.length,
    registered: 0,
  };

  // Small fixed pool: these are third-party APIs and we are a guest on them.
  const queue = [...batch];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      for (;;) {
        const candidate = queue.shift();
        if (candidate === undefined) return;
        if (signal.aborted) return;

        const outcome = await probeCompany(candidate, signal);
        result.probed += 1;

        if (outcome.found !== null) {
          result.found += 1;
          const sourceId = await registerSource(candidate, outcome.found);
          if (sourceId !== null) result.registered += 1;
          await recordProbe(candidate, "found", outcome.found, sourceId, null);
        } else {
          await recordProbe(
            candidate,
            outcome.error === undefined ? "not_found" : "error",
            null,
            null,
            outcome.error ?? null,
          );
        }
      }
    },
  );

  await Promise.all(workers);
  return result;
}

/** Try each candidate slug against each ATS until one answers with a board. */
export async function probeCompany(
  candidate: CompanyCandidate,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  const slugs = candidateSlugs(candidate);
  let lastError: string | undefined;

  for (const slug of slugs) {
    for (const prober of PROBERS) {
      try {
        const response = await fetch(prober.url(slug), {
          headers: {
            accept: "application/json",
            "user-agent":
              "recruiting-pipeline/1.0 (personal job search tool)",
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
        });

        // 404 is the common, expected answer: this company isn't on this ATS.
        if (!response.ok) continue;

        const payload: unknown = await response.json();
        const count = prober.count(payload);

        // An empty board is indistinguishable from a wrong slug on some
        // providers, so only a board with postings counts as a hit.
        if (count === null || count === 0) continue;

        return {
          candidate,
          found: { kind: prober.kind, slug, jobCount: count },
        };
      } catch (error) {
        if (signal.aborted) return { candidate, found: null, error: "aborted" };
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return { candidate, found: null, error: lastError };
}

/**
 * Slug candidates, most likely first.
 * Most companies use their own name; the YC slug is usually the same string.
 */
export function candidateSlugs(candidate: CompanyCandidate): string[] {
  const slugs = new Set<string>();

  for (const hint of candidate.slugHints ?? []) {
    if (hint.length > 1) slugs.add(hint.toLowerCase());
  }

  const dashed = slugifyCompany(candidate.name);
  slugs.add(dashed);
  slugs.add(dashed.replace(/-/g, ""));

  // Boards are usually registered against the bare domain label.
  if (candidate.website) {
    try {
      const host = new URL(candidate.website).hostname.replace(/^www\./, "");
      const label = host.split(".")[0];
      if (label !== undefined && label.length > 1) slugs.add(label.toLowerCase());
    } catch {
      // Unparseable website: the name-derived slugs are enough.
    }
  }

  return [...slugs].filter((slug) => slug.length > 1).slice(0, 4);
}

/** Drop candidates probed recently enough that re-probing is wasted effort. */
async function filterAlreadyProbed(
  candidates: CompanyCandidate[],
): Promise<CompanyCandidate[]> {
  if (candidates.length === 0) return [];

  const keys = candidates.map((candidate) => candidate.externalKey);
  const rows = await sql<{ externalKey: string }[]>`
    select external_key from company_board_probes
    where external_key = any(${keys})
      and (
        result = 'found'
        or probed_at > now() - ${`${NOT_FOUND_COOLDOWN_DAYS} days`}::interval
      )
  `;

  const seen = new Set(rows.map((row) => row.externalKey));
  return candidates.filter((candidate) => !seen.has(candidate.externalKey));
}

async function registerSource(
  candidate: CompanyCandidate,
  found: { kind: SourceKind; slug: string },
): Promise<number | null> {
  const config: Record<string, string> =
    found.kind === "greenhouse"
      ? { board: found.slug, company: candidate.name }
      : found.kind === "lever"
        ? { company: found.slug, displayName: candidate.name }
        : { org: found.slug, displayName: candidate.name };

  if (candidate.website) config.website = candidate.website;

  const rows = await sql<{ id: number }[]>`
    insert into job_sources (kind, name, config, enabled, priority)
    values (
      ${found.kind}, ${candidate.name}, ${sql.json(json(config))}, true, -1
    )
    on conflict (kind, name) do update
      set config = excluded.config, updated_at = now()
    returning id
  `;
  return rows[0]?.id ?? null;
}

async function recordProbe(
  candidate: CompanyCandidate,
  result: "found" | "not_found" | "error",
  found: { kind: SourceKind; slug: string } | null,
  sourceId: number | null,
  error: string | null,
): Promise<void> {
  await sql`
    insert into company_board_probes (
      external_key, company_name, website, result, found_kind, found_slug,
      source_id, error
    ) values (
      ${candidate.externalKey}, ${candidate.name}, ${candidate.website ?? null},
      ${result}, ${found?.kind ?? null}, ${found?.slug ?? null},
      ${sourceId}, ${error}
    )
    on conflict (external_key) do update set
      probed_at  = now(),
      result     = excluded.result,
      found_kind = excluded.found_kind,
      found_slug = excluded.found_slug,
      source_id  = coalesce(excluded.source_id, company_board_probes.source_id),
      attempts   = company_board_probes.attempts + 1,
      error      = excluded.error
  `;
}
