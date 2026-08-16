import Link from "next/link";
import { ScoreBadge, StatusBadge, Tag, relativeTime } from "./ui";
import { JobCardActions } from "./job-card-actions";
import type { JobListItem } from "@/lib/types";

/**
 * One row in the Discover feed.
 *
 * A **server** component. It used to be a client component in its entirety,
 * which meant React had to serialize the whole `JobListItem` into the RSC
 * payload as props for every row *in addition to* the rendered markup. With
 * 130 rows that produced a 707KB response and a ~480ms render.
 *
 * Only the four buttons genuinely need interactivity, so only they cross into
 * the client — carrying an id and two booleans rather than an entire job.
 */
export function JobCard({ job }: { job: JobListItem }) {
  // Freshness is computed by the database, not here: calling Date.now() during
  // render is impure and gives every row a slightly different "now".
  const postedAt = job.postedAt ?? job.discoveredAt;
  const isFresh = job.isFresh;

  return (
    <article className="panel row-hover group px-3 py-2.5">
      <div className="flex items-start gap-3">
        <ScoreBadge score={job.score} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={`/jobs/${job.id}`}
              className="truncate font-medium hover:text-accent"
            >
              {job.companyName}
            </Link>
            <span className="truncate text-muted">{job.title}</span>
            {isFresh && (
              <span
                className="shrink-0 rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success"
                title="Posted in the last three days"
              >
                New
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-faint">
            <span>{job.locationRaw ?? "Location not listed"}</span>
            {job.payLabel !== null && (
              <span className="font-medium text-success">{job.payLabel}</span>
            )}
            {job.isRemote && <Tag tone="muted">Remote</Tag>}
            {job.season !== null && <span>· {job.season}</span>}
            <span className={isFresh ? "text-success" : undefined}>
              · posted {relativeTime(postedAt)}
            </span>
            <span>· {job.sourceKind}</span>
            {job.duplicateCount > 0 && (
              <span title="Also listed on other boards">
                · +{job.duplicateCount} dup
              </span>
            )}
            {job.applicationStatus !== null && (
              <StatusBadge status={job.applicationStatus} />
            )}
          </div>

          {job.scoreSummary !== null && (
            <p className="mt-1.5 line-clamp-2 text-muted">{job.scoreSummary}</p>
          )}

          {(job.strongestSkills.length > 0 ||
            job.missingRequirements.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {job.strongestSkills.slice(0, 5).map((skill) => (
                <Tag key={skill}>{skill}</Tag>
              ))}
              {job.missingRequirements.slice(0, 2).map((gap) => (
                <Tag key={gap} tone="danger">
                  missing: {gap}
                </Tag>
              ))}
            </div>
          )}
        </div>

        <JobCardActions
          jobId={job.id}
          jobUrl={job.url}
          alreadyApplied={job.applicationStatus === "applied"}
        />
      </div>
    </article>
  );
}
