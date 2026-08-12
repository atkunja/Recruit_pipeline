"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Header actions on the job detail page. */
export function JobActions({
  jobId,
  jobUrl,
  isIgnored,
  hasApplication,
}: {
  jobId: number;
  jobUrl: string;
  isIgnored: boolean;
  hasApplication: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function call(path: string, body?: unknown) {
    startTransition(async () => {
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
            : `Failed (${response.status})`,
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <a
          href={jobUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-md border border-border px-2.5 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
        >
          Open posting
        </a>

        <button
          type="button"
          onClick={() => call(`/api/jobs/${jobId}/prepare`)}
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Working…" : hasApplication ? "Regenerate" : "Prepare"}
        </button>

        <button
          type="button"
          onClick={() => call(`/api/jobs/${jobId}/applied`)}
          disabled={pending}
          className="rounded-md border border-border px-2.5 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
        >
          Mark applied
        </button>

        <button
          type="button"
          onClick={() => call(`/api/jobs/${jobId}/ignore`, { ignored: !isIgnored })}
          disabled={pending}
          className="rounded-md border border-border px-2.5 py-1.5 text-faint transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-40"
        >
          {isIgnored ? "Un-ignore" : "Ignore"}
        </button>
      </div>

      {error !== null && (
        <p className="max-w-xs text-right text-[11px] text-danger">{error}</p>
      )}
    </div>
  );
}
