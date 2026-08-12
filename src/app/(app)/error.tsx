"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary.
 *
 * Without this a thrown server component produced a blank page and a spinner
 * that never resolved, which is exactly how a hung database query presented —
 * no error anywhere, just a page that never finished. An explicit boundary
 * turns any failure into something readable and retryable.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render failed", error);
  }, [error]);

  const isDatabase = /connect|timeout|ECONN|postgres|terminating/i.test(error.message);
  const isBudget = /budget/i.test(error.message);
  const isProfile = /No profile row/i.test(error.message);

  return (
    <div className="mx-auto max-w-lg py-16">
      <div className="panel p-5">
        <h1 className="mb-1 text-[15px] font-semibold">Something broke</h1>
        <p className="mb-3 text-muted">
          {isProfile
            ? "No profile has been seeded yet. Fill in db/profile.json and run npm run db:seed."
            : isDatabase
              ? "The database didn't respond. Check that Supabase is up and DATABASE_URL points at the session pooler (port 5432)."
              : isBudget
                ? "The monthly AI budget is exhausted. Raise OPENAI_MONTHLY_BUDGET_USD or wait for the month to roll over."
                : "An unexpected error occurred while rendering this page."}
        </p>

        <pre className="mb-4 max-h-40 overflow-auto rounded-md border border-border bg-surface px-2.5 py-2 text-[11px] text-faint">
          {error.message}
          {error.digest !== undefined && `\n\ndigest: ${error.digest}`}
        </pre>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-border px-3 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Back to Today
          </Link>
          <a
            href="/api/health"
            className="ml-auto text-[11px] text-faint transition-colors hover:text-muted"
          >
            Health check →
          </a>
        </div>
      </div>
    </div>
  );
}
