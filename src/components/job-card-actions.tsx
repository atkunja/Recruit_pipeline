"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The interactive part of a Discover row.
 *
 * Split out from JobCard so the feed's markup stays on the server. Its props
 * are an id, a URL and a boolean — the entire job object no longer has to be
 * serialized into the RSC payload for every row.
 */
export function JobCardActions({
  jobId,
  jobUrl,
  alreadyApplied,
}: {
  jobId: number;
  jobUrl: string;
  alreadyApplied: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: unknown): Promise<boolean> {
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
      if (await post(`/api/jobs/${jobId}/ignore`, { ignored: true })) {
        setDismissed(true);
        router.refresh();
      }
    });
  }

  function markApplied() {
    startTransition(async () => {
      if (await post(`/api/jobs/${jobId}/applied`)) {
        // Vanish straight away. The row also leaves the feed on refresh, since
        // Discover now hides anything with an application, but waiting for the
        // round trip made the button look like it had done nothing.
        setDismissed(true);
        router.refresh();
      }
    });
  }

  function prepare() {
    startTransition(async () => {
      if (await post(`/api/jobs/${jobId}/prepare`)) router.push(`/jobs/${jobId}`);
    });
  }

  // Hide the row's controls once it has been ignored or applied to; the row
  // itself leaves the feed on the next render.
  if (dismissed) return null;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className={`flex items-center gap-1 ${pending ? "opacity-60" : ""}`}>
        <a
          href={jobUrl}
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
          disabled={pending || alreadyApplied}
          title="Record that you already applied, and remove this from Discover"
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

      {error !== null && (
        <p className="max-w-[220px] text-right text-[11px] text-danger">{error}</p>
      )}
    </div>
  );
}
