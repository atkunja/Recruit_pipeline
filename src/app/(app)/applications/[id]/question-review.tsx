"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel, Tag } from "@/components/ui";

interface Question {
  id: number;
  question: string;
  answer: string | null;
  needsReview: boolean;
  isSensitive: boolean;
}

/**
 * Review and approve the prepared answers.
 *
 * Sensitive questions get a distinct treatment: never pre-filled, and saving an
 * answer for reuse is a separate opt-in checkbox rather than the default.
 */
export function QuestionReview({
  applicationId,
  questions,
}: {
  applicationId: number;
  questions: Question[];
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);

    const response = await fetch(`/api/applications/${applicationId}/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    setGenerating(false);

    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      setError(
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : "Could not generate answers",
      );
      return;
    }
    router.refresh();
  }

  const needsReview = questions.filter((question) => question.needsReview);

  return (
    <Panel className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="eyebrow">Application questions</h2>
        {needsReview.length > 0 && (
          <Tag tone="danger">{needsReview.length} need you</Tag>
        )}
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="ml-auto rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {generating
            ? "Writing…"
            : questions.length === 0
              ? "Prepare answers"
              : "Prepare more"}
        </button>
      </div>

      {error !== null && (
        <p className="mb-2 rounded-md bg-danger-soft px-2 py-1.5 text-danger">
          {error}
        </p>
      )}

      {questions.length === 0 ? (
        <p className="text-faint">
          No answers prepared yet. &ldquo;Prepare answers&rdquo; drafts the questions
          almost every internship application asks, using only your verified
          profile.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {questions.map((question) => (
            <AnswerRow key={question.id} question={question} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function AnswerRow({ question }: { question: Question }) {
  const router = useRouter();
  const [value, setValue] = useState(question.answer ?? "");
  const [savePreference, setSavePreference] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(approve: boolean) {
    setBusy(true);
    setSaved(false);

    const response = await fetch(`/api/questions/${question.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: value, approve, savePreference }),
    });

    setBusy(false);
    if (response.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  const dirty = value !== (question.answer ?? "");

  return (
    <div
      className={`rounded-md border p-2.5 ${
        question.needsReview ? "border-warn/40 bg-warn-soft/30" : "border-border"
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{question.question}</span>
        {question.isSensitive && <Tag tone="muted">you answer this</Tag>}
        {question.needsReview && <Tag tone="danger">needs review</Tag>}
      </div>

      {question.isSensitive && question.answer === null && (
        <p className="mb-1.5 text-[11px] text-faint">
          Self-identification and compensation questions are never answered for
          you. Fill it in if you want it saved; leave it blank to answer on the
          form itself.
        </p>
      )}

      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={Math.min(8, Math.max(2, Math.ceil(value.length / 90) + 1))}
        placeholder={question.isSensitive ? "Left blank on purpose" : "No answer yet"}
        className="w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 leading-relaxed outline-none focus:border-accent"
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => save(true)}
          disabled={busy || value.trim().length === 0}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save & approve"}
        </button>

        {question.isSensitive && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-faint">
            <input
              type="checkbox"
              checked={savePreference}
              onChange={(event) => setSavePreference(event.target.checked)}
              className="accent-accent"
            />
            Remember this answer for future applications
          </label>
        )}

        <span className="ml-auto text-[11px] text-faint">
          {value.length} chars
          {dirty && " · unsaved"}
          {saved && !dirty && " · saved"}
        </span>
      </div>
    </div>
  );
}
