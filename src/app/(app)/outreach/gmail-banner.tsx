"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GmailStatus } from "@/lib/gmail/client";

/** Gmail connection state, with connect / sync / disconnect. */
export function GmailBanner({ status }: { status: GmailStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!status.configured) {
    return (
      <div className="mb-4 rounded-lg border border-border bg-surface px-3 py-2.5">
        <p className="text-muted">
          Gmail isn&apos;t configured. Set <code>GOOGLE_CLIENT_ID</code> and{" "}
          <code>GOOGLE_CLIENT_SECRET</code> to send outreach and track replies.
          Everything else works without it.
        </p>
      </div>
    );
  }

  async function sync() {
    setBusy(true);
    setMessage(null);

    const response = await fetch("/api/gmail/sync", { method: "POST" });
    const data: unknown = await response.json().catch(() => null);
    setBusy(false);

    if (!response.ok) {
      setMessage(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : "Sync failed",
      );
      return;
    }

    const result = data as { stored: number; statusUpdates: number; needsReview: number };
    setMessage(
      `${result.stored} recruiting message(s), ${result.statusUpdates} status update(s), ${result.needsReview} to review.`,
    );
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    await fetch("/api/gmail/status", { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  if (!status.connected) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5">
        <div>
          <p className="font-medium">Gmail not connected</p>
          <p className="text-muted">
            Connect to send approved outreach and detect recruiter replies.
            Requests send and read-only scopes — never permission to delete mail.
          </p>
        </div>
        <a
          href="/api/gmail/connect"
          className="ml-auto rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          Connect Gmail
        </a>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-success">●</span>
      <span className="text-muted">
        Connected as <span className="text-text">{status.email}</span>
      </span>
      {message !== null && <span className="text-[11px] text-faint">{message}</span>}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="rounded-md border border-border px-2.5 py-1 text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
        >
          {busy ? "Syncing…" : "Sync now"}
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="rounded-md px-2 py-1 text-faint transition-colors hover:text-danger disabled:opacity-40"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
