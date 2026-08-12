"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel, Tag } from "@/components/ui";

interface Draft {
  id: number;
  subject: string;
  body: string;
  status: string;
  kind: string;
  error: string | null;
  contactName: string;
  contactEmail: string | null;
  companyName: string;
  jobTitle: string | null;
  approvedAt: string | null;
}

/**
 * One outreach draft: read it, edit it, approve it, send it.
 *
 * Approve and Send are separate actions on purpose. Approving records that you
 * read the thing; sending is the irreversible step and is its own click, with
 * the recipient address shown next to it.
 */
export function OutreachDraft({
  draft,
  canSend,
}: {
  draft: Draft;
  canSend: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(draft.error);
  const [confirmingSend, setConfirmingSend] = useState(false);

  const edited = subject !== draft.subject || body !== draft.body;
  const approved = draft.approvedAt !== null || draft.status === "approved";

  async function call(path: string, payload?: unknown) {
    setBusy(true);
    setError(null);

    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

    setBusy(false);

    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setError(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Failed (${response.status})`,
      );
      return false;
    }

    router.refresh();
    return true;
  }

  async function approve() {
    if (await call(`/api/outreach/${draft.id}/approve`, { subject, body })) {
      setEditing(false);
    }
  }

  async function send() {
    if (await call(`/api/outreach/${draft.id}/send`)) {
      setConfirmingSend(false);
    }
  }

  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

  return (
    <Panel className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{draft.contactName}</span>
        <span className="text-muted">{draft.companyName}</span>
        {draft.kind === "follow_up" && <Tag>follow-up</Tag>}
        {approved && <Tag>approved</Tag>}
        {draft.status === "failed" && <Tag tone="danger">send failed</Tag>}

        <span className="ml-auto text-[11px] text-faint">
          {draft.contactEmail ?? "no email on file"} · {wordCount} words
        </span>
      </div>

      {draft.jobTitle !== null && (
        <p className="mb-2 text-[11px] text-faint">Re: {draft.jobTitle}</p>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 outline-none focus:border-accent"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 leading-relaxed outline-none focus:border-accent"
          />
        </div>
      ) : (
        <div className="rounded-md border border-border bg-surface px-3 py-2.5">
          <p className="mb-1.5 font-medium">{subject}</p>
          <p className="whitespace-pre-wrap leading-relaxed text-muted">{body}</p>
        </div>
      )}

      {error !== null && (
        <p className="mt-2 rounded-md bg-danger-soft px-2 py-1.5 text-danger">
          {error}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          disabled={busy}
          className="rounded-md border border-border px-2.5 py-1 text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
        >
          {editing ? "Done editing" : "Edit"}
        </button>

        {!approved && (
          <button
            type="button"
            onClick={approve}
            disabled={busy}
            className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "…" : edited ? "Save & approve" : "Approve"}
          </button>
        )}

        {approved && !confirmingSend && (
          <button
            type="button"
            onClick={() => setConfirmingSend(true)}
            disabled={busy || !canSend || draft.contactEmail === null}
            title={
              !canSend
                ? "Connect Gmail to send"
                : draft.contactEmail === null
                  ? "This contact has no email address"
                  : undefined
            }
            className="rounded-md bg-success px-2.5 py-1 font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Send…
          </button>
        )}

        {confirmingSend && (
          <div className="flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1">
            <span className="text-warn">
              Send to {draft.contactEmail}?
            </span>
            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="rounded bg-success px-2 py-0.5 font-medium text-bg disabled:opacity-40"
            >
              {busy ? "Sending…" : "Yes, send"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingSend(false)}
              className="rounded px-1.5 py-0.5 text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
        )}

        {edited && !editing && (
          <span className="text-[11px] text-warn">unsaved edits</span>
        )}
      </div>
    </Panel>
  );
}
