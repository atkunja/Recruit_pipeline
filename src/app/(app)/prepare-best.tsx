"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Candidate {
  jobId: number;
  title: string;
  companyName: string;
  score: number;
}

interface PrepareProgress {
  jobId: number;
  companyName: string;
  state: "pending" | "running" | "done" | "failed";
  detail?: string;
}

/**
 * "Prepare Today's Best".
 *
 * Runs the prepare pipeline over the top N opportunities one at a time,
 * streaming progress as it goes. Sequential rather than parallel on purpose:
 * each job is two model calls, and a burst of ten concurrent requests is how
 * you trip a rate limit and get half your batch failing.
 */
export function PrepareBestButton({ candidates }: { candidates: Candidate[] }) {
  const router = useRouter();
  const [count, setCount] = useState(5);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PrepareProgress[]>([]);

  const available = Math.min(count, candidates.length);

  async function run() {
    const batch = candidates.slice(0, available);
    setRunning(true);
    setProgress(
      batch.map((candidate) => ({
        jobId: candidate.jobId,
        companyName: candidate.companyName,
        state: "pending",
      })),
    );

    for (const candidate of batch) {
      setProgress((current) =>
        current.map((item) =>
          item.jobId === candidate.jobId ? { ...item, state: "running" } : item,
        ),
      );

      try {
        const response = await fetch(`/api/jobs/${candidate.jobId}/prepare`, {
          method: "POST",
        });

        if (!response.ok) {
          const data: unknown = await response.json().catch(() => null);
          const message =
            data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : `Failed (${response.status})`;

          setProgress((current) =>
            current.map((item) =>
              item.jobId === candidate.jobId
                ? { ...item, state: "failed", detail: message }
                : item,
            ),
          );

          // A budget stop applies to every remaining job; don't burn through
          // the rest of the batch producing the same error ten times.
          if (response.status === 402) break;
          continue;
        }

        const result = (await response.json()) as {
          integrityOk: boolean;
          fellBackToCanonical: boolean;
        };

        setProgress((current) =>
          current.map((item) =>
            item.jobId === candidate.jobId
              ? {
                  ...item,
                  state: "done",
                  detail: result.integrityOk
                    ? result.fellBackToCanonical
                      ? "ready — reworded bullets reverted"
                      : "ready for review"
                    : "needs review — integrity check failed",
                }
              : item,
          ),
        );
      } catch (error) {
        setProgress((current) =>
          current.map((item) =>
            item.jobId === candidate.jobId
              ? {
                  ...item,
                  state: "failed",
                  detail: error instanceof Error ? error.message : "Network error",
                }
              : item,
          ),
        );
      }
    }

    setRunning(false);
    router.refresh();
  }

  if (candidates.length === 0) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1.5">
        <select
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          disabled={running}
          className="rounded-md border border-border bg-surface px-2 py-1.5 outline-none transition-colors focus:border-accent disabled:opacity-50"
        >
          <option value={3}>Top 3</option>
          <option value={5}>Top 5</option>
          <option value={10}>Top 10</option>
        </select>

        <button
          type="button"
          onClick={run}
          disabled={running || available === 0}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running
            ? `Preparing ${progress.filter((p) => p.state === "done").length}/${available}…`
            : `Prepare today's best ${available}`}
        </button>
      </div>

      {progress.length > 0 && (
        <ul className="panel w-72 divide-y divide-border text-[11px]">
          {progress.map((item) => (
            <li key={item.jobId} className="flex items-baseline gap-2 px-2.5 py-1.5">
              <span
                aria-hidden
                className={
                  item.state === "done"
                    ? "text-success"
                    : item.state === "failed"
                      ? "text-danger"
                      : item.state === "running"
                        ? "text-accent"
                        : "text-faint"
                }
              >
                {item.state === "done"
                  ? "✓"
                  : item.state === "failed"
                    ? "✕"
                    : item.state === "running"
                      ? "◐"
                      : "○"}
              </span>
              <span className="truncate">{item.companyName}</span>
              {item.detail !== undefined && (
                <span className="ml-auto shrink-0 text-faint">{item.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
