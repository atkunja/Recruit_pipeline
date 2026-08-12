"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScoreBadge, StatusBadge, Tag, relativeTime } from "./ui";
import type { JobListItem } from "@/lib/types";

/**
 * One row in the Discover feed.
 *
 * Dense by design: score, company, role, location, why it fits, and the four
 * actions all need to be readable without expanding anything.
 */
export function JobCard({ job }: { job: JobListItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: unknown) {
    setError(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setError(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Request failed (${response.status})`,
      );
      return false;
    }
    return true;
  }

  function ignore() {
    startTransition(async () => {
      if (await post(`/api/jobs/${job.id}/ignore`, { ignored: true })) {
        setDismissed(true);
        router.refresh();
      }
    });
  }

  function markApplied() {
    startTransition(async () => {
      if (await post(`/api/jobs/${job.id}/applied`)) router.refresh();
    });
  }

  function prepare() {
    startTransition(async () => {
      if (await post(`/api/jobs/${job.id}/prepare`)) {
        router.push(`/jobs/${job.id}`);
      }
    });
  }

  if (dismissed) return null;

  const components = job.components;

  return (
    <article
      className={`panel row-hover group px-3 py-2.5 transition-opacity ${
        pending ? "opacity-60" : ""
      }`}
    >
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
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-faint">
            <span>{job.locationRaw ?? "Location not listed"}</span>
            {job.isRemote && <Tag tone="muted">Remote</Tag>}
            {job.season !== null && <span>· {job.season}</span>}
            <span>· found {relativeTime(job.discoveredAt)}</span>
            {job.postedAt !== null && (
              <span>· posted {relativeTime(job.postedAt)}</span>
            )}
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

          {components !== null && (
            <div className="mt-1.5 hidden gap-2 text-[11px] text-faint group-hover:flex">
              {Object.entries(components).map(([key, component]) => (
                <span key={key} className="tabular-nums">
                  {key} {component.score}/{component.max}
                </span>
              ))}
            </div>
          )}

          {error !== null && (
            <p className="mt-1.5 text-[11px] text-danger">{error}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            View
          </a>
          <button
            type="button"
            onClick={prepare}
            disabled={pending}
            className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Prepare
          </button>
          <button
            type="button"
            onClick={markApplied}
            disabled={pending || job.applicationStatus === "applied"}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
          >
            Applied
          </button>
          <button
            type="button"
            onClick={ignore}
            disabled={pending}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-faint transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-40"
          >
            Ignore
          </button>
        </div>
      </div>
    </article>
  );
}
