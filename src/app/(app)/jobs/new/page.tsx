"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";

interface IngestResponse {
  jobId: number;
  isNew: boolean;
  isDuplicate: boolean;
  prefilter: string;
  prefilterReasons: string[];
  score: number | null;
  fetchError: string | null;
}

/**
 * Manual job entry.
 *
 * Paste a URL and the ATS fields fill themselves in; the optional overrides are
 * there for career pages we can't parse.
 */
export default function NewJobPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [showOverrides, setShowOverrides] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/jobs/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: form.get("url"),
        company: form.get("company") || undefined,
        title: form.get("title") || undefined,
        location: form.get("location") || undefined,
        description: form.get("description") || undefined,
      }),
    });

    const data: unknown = await response.json().catch(() => null);
    setPending(false);

    if (!response.ok) {
      setError(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Failed (${response.status})`,
      );
      setShowOverrides(true);
      return;
    }

    setResult(data as IngestResponse);
    router.refresh();
  }

  const inputClass =
    "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-text outline-none transition-colors focus:border-accent";

  return (
    <>
      <PageHeader
        title="Add a job"
        subtitle="Paste a posting URL. Greenhouse, Lever and Ashby links are read directly from their APIs."
      />

      <form onSubmit={onSubmit} className="panel max-w-2xl p-4">
        <label htmlFor="url" className="eyebrow mb-1.5 block">
          Job URL
        </label>
        <input
          id="url"
          name="url"
          type="url"
          required
          autoFocus
          placeholder="https://job-boards.greenhouse.io/company/jobs/1234567"
          className={inputClass}
        />

        <button
          type="button"
          onClick={() => setShowOverrides((value) => !value)}
          className="mt-2.5 text-faint transition-colors hover:text-muted"
        >
          {showOverrides ? "− Hide" : "+ Add"} details manually
        </button>

        {showOverrides && (
          <div className="mt-3 grid gap-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="company" className="eyebrow mb-1.5 block">
                  Company
                </label>
                <input id="company" name="company" className={inputClass} />
              </div>
              <div>
                <label htmlFor="title" className="eyebrow mb-1.5 block">
                  Title
                </label>
                <input id="title" name="title" className={inputClass} />
              </div>
            </div>

            <div>
              <label htmlFor="location" className="eyebrow mb-1.5 block">
                Location
              </label>
              <input
                id="location"
                name="location"
                placeholder="Seattle, WA"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="description" className="eyebrow mb-1.5 block">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={8}
                placeholder="Paste the full job description. This is what scoring and tailoring read."
                className={`${inputClass} resize-y font-mono text-[12px]`}
              />
            </div>
          </div>
        )}

        {error !== null && (
          <p className="mt-3 rounded-md bg-danger-soft px-2.5 py-1.5 text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Fetching and scoring…" : "Add and score"}
        </button>
      </form>

      {result !== null && (
        <div className="panel mt-3 max-w-2xl p-4">
          <div className="flex items-center gap-3">
            <span
              className={`text-[24px] font-semibold tabular-nums ${
                (result.score ?? 0) >= 85 ? "text-success" : "text-text"
              }`}
            >
              {result.score ?? "—"}
            </span>
            <div>
              <p className="font-medium">
                {result.isDuplicate
                  ? "Already tracked — linked as a duplicate"
                  : result.isNew
                    ? "Job added"
                    : "Job updated"}
              </p>
              <p className="text-muted">
                Prefilter: {result.prefilter}
                {result.prefilterReasons.length > 0 &&
                  ` — ${result.prefilterReasons.join(", ")}`}
              </p>
            </div>
            <a
              href={`/jobs/${result.jobId}`}
              className="ml-auto rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg"
            >
              Open
            </a>
          </div>

          {result.fetchError !== null && (
            <p className="mt-2 text-[11px] text-warn">
              Note: couldn&apos;t read the page automatically ({result.fetchError}).
              Scoring used whatever you entered by hand.
            </p>
          )}
        </div>
      )}
    </>
  );
}
