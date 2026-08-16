import Link from "next/link";
import { JobCard } from "@/components/job-card";
import { EmptyState, PageHeader } from "@/components/ui";
import { listDiscoverJobs, type DiscoverFilters } from "@/lib/jobs/repository";
import { getScoringWeights } from "@/lib/settings";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/types";
import { DiscoverFiltersBar } from "./filters";

export const dynamic = "force-dynamic";

/** Rows per page. The feed is dense, so a page of markup adds up fast. */
const PAGE_SIZE = 50;

interface SearchParams {
  minScore?: string;
  minPay?: string;
  limit?: string;
  company?: string;
  q?: string;
  location?: string;
  since?: string;
  status?: string;
  sort?: string;
  ignored?: string;
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const weights = await getScoringWeights();

  const requested = Number(params.limit ?? PAGE_SIZE);
  const shown = Number.isFinite(requested)
    ? Math.min(Math.max(requested, PAGE_SIZE), 500)
    : PAGE_SIZE;

  // Show everything found by default.
  //
  // This used to default to the configured score floor, which meant scoring
  // became a gate on seeing your own data: 433 jobs discovered, 160 visible,
  // and the 185 that had not been scored yet were invisible entirely. Scoring
  // should order the feed, not hide most of it. The floor is still one click
  // away in the filter bar.
  const minScore =
    params.minScore === undefined || params.minScore === ""
      ? null
      : Number(params.minScore);

  const status = APPLICATION_STATUSES.includes(params.status as ApplicationStatus)
    ? (params.status as ApplicationStatus)
    : params.status === "none"
      ? "none"
      : null;

  const filters: DiscoverFilters = {
    minScore: Number.isFinite(minScore) ? minScore : null,
    companyId: params.company ? Number(params.company) : null,
    search: params.q ?? null,
    location: params.location ?? null,
    discoveredSince: params.since ? sinceToIso(params.since) : null,
    status,
    includeIgnored: params.ignored === "1",
    minMonthlyPay: params.minPay ? Number(params.minPay) : null,
    sort:
      params.sort === "discovered" ||
      params.sort === "posted" ||
      params.sort === "pay"
        ? params.sort
        : "score",
    // Fetch one extra to know whether another page exists without a count query.
    limit: shown + 1,
  };

  const fetched = await listDiscoverJobs(filters);
  const hasMore = fetched.length > shown;
  const jobs = hasMore ? fetched.slice(0, shown) : fetched;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const newToday = jobs.filter(
    (job) => new Date(job.discoveredAt) >= startOfToday,
  ).length;
  const unscored = jobs.filter((job) => job.score === null).length;

  return (
    <>
      <PageHeader
        title="Discover"
        subtitle={
          <>
            showing <span className="font-medium text-text">{jobs.length}</span>
            {hasMore && " (more below)"}
            {unscored > 0 && (
              <>
                {" · "}
                <span className="text-muted">{unscored} not scored yet</span>
              </>
            )}
            {newToday > 0 && (
              <>
                {" · "}
                <span className="text-success">{newToday} new today</span>
              </>
            )}
          </>
        }
        actions={
          <Link
            href="/jobs/new"
            className="rounded-md border border-border px-2.5 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Add job manually
          </Link>
        }
      />

      <DiscoverFiltersBar defaultMinScore={weights.minimumDisplayScore} />

      {jobs.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          hint="Either discovery hasn't run yet, or your filters are too tight. Run discovery from Settings → Sources."
          action={
            <Link
              href="/discover?minScore="
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg"
            >
              Show all scores
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>

          {hasMore && (
            <div className="mt-3 flex justify-center">
              <Link
                href={`/discover?${new URLSearchParams({
                  ...Object.fromEntries(
                    Object.entries(params).filter(
                      ([key, value]) => key !== "limit" && value !== undefined,
                    ) as [string, string][],
                  ),
                  limit: String(shown + PAGE_SIZE),
                }).toString()}`}
                scroll={false}
                className="rounded-md border border-border px-3 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
              >
                Show {PAGE_SIZE} more
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Translate the `since` shortcut into an ISO timestamp. */
function sinceToIso(since: string): string | null {
  const now = Date.now();
  const days: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 };
  const value = days[since];
  if (value === undefined) return null;
  return new Date(now - value * 86400_000).toISOString();
}
