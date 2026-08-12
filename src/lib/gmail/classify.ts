import "server-only";
import { z } from "zod";
import { complete } from "../ai/client";
import { EMAIL_CLASSIFICATIONS, type EmailClassification } from "../types";

/**
 * Email triage.
 *
 * A deterministic pass handles the obvious cases for free, and only what's left
 * goes to the cheap model — in one batched call, not one per message.
 */

export interface EmailToClassify {
  id: string;
  from: string;
  subject: string;
  snippet: string;
}

export interface EmailVerdict {
  id: string;
  classification: EmailClassification;
  /** 0..1. Below 0.75 the UI asks rather than acting. */
  confidence: number;
}

const ResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      classification: z.enum(EMAIL_CLASSIFICATIONS),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const SYSTEM_PROMPT = `You triage a job-seeker's incoming email.

Classify each message as exactly one of:
- recruiter_reply: a human from a company replying about an application or outreach
- interview_invite: invites the candidate to an interview or asks for availability
- oa_invite: invites the candidate to an online assessment, coding test or take-home
- rejection: declines the candidate
- follow_up: a nudge or status update on an existing conversation
- auto_ack: an automated "we received your application" receipt
- other: anything unrelated to this candidate's job search — newsletters, marketing, job alerts, university mail, personal mail
- unknown: genuinely ambiguous

Be conservative. Marketing email from a company the candidate applied to is "other", not "recruiter_reply". A mass job-alert digest is "other".

confidence is how sure you are, 0 to 1. Use below 0.75 whenever a human should check.`;

/** Obvious cases, decided without spending anything. */
function deterministic(email: EmailToClassify): EmailVerdict | null {
  const from = email.from.toLowerCase();
  const text = `${email.subject} ${email.snippet}`.toLowerCase();

  // Bulk senders are never a recruiter writing to you personally.
  if (
    /(newsletter|noreply|no-reply|donotreply|notifications?|updates?|digest|alerts?|marketing|info|hello|support)@/.test(
      from,
    ) &&
    !/(greenhouse|lever|ashby|workday|myworkday|icims|smartrecruiters|jobvite)/.test(from)
  ) {
    return { id: email.id, classification: "other", confidence: 0.9 };
  }

  if (/\b(unsubscribe|view (this )?in browser|promotional)\b/.test(text) &&
      !/\b(interview|assessment|offer)\b/.test(text)) {
    return { id: email.id, classification: "other", confidence: 0.85 };
  }

  // A very high-signal phrase, but still only 0.8 — "we received your
  // application" and a real rejection can look similar in a snippet.
  if (
    /\b(thank you for (your )?(interest|applying)|we (have )?received your application|application (has been )?received)\b/.test(
      text,
    ) &&
    !/\b(unfortunately|not (be )?moving forward|other candidates)\b/.test(text)
  ) {
    return { id: email.id, classification: "auto_ack", confidence: 0.8 };
  }

  return null;
}

export async function classifyEmails(
  emails: EmailToClassify[],
): Promise<EmailVerdict[]> {
  if (emails.length === 0) return [];

  const verdicts: EmailVerdict[] = [];
  const remaining: EmailToClassify[] = [];

  for (const email of emails) {
    const quick = deterministic(email);
    if (quick !== null) verdicts.push(quick);
    else remaining.push(email);
  }

  if (remaining.length === 0) return verdicts;

  // Batch: ~30 messages fit comfortably in one cheap call.
  for (let index = 0; index < remaining.length; index += 30) {
    const batch = remaining.slice(index, index + 30);

    try {
      const response = await complete({
        purpose: "classify",
        tier: "cheap",
        system: SYSTEM_PROMPT,
        user: [
          "Classify each email.",
          "",
          ...batch.map(
            (email) =>
              `id: ${email.id}\nfrom: ${email.from}\nsubject: ${email.subject}\nsnippet: ${email.snippet.slice(0, 300)}\n`,
          ),
          '',
          'Return JSON: {"results":[{"id":"...","classification":"...","confidence":0.0}]}',
        ].join("\n"),
        schema: ResponseSchema,
        schemaName: "EmailClassifications",
        temperature: 0,
        maxOutputTokens: 100 + batch.length * 40,
      });

      const byId = new Map(response.results.map((item) => [item.id, item]));
      for (const email of batch) {
        const verdict = byId.get(email.id);
        verdicts.push(
          verdict ?? { id: email.id, classification: "unknown", confidence: 0 },
        );
      }
    } catch (error) {
      // A failed batch must not lose the messages — mark them for review.
      console.error("[classify] batch failed", error);
      for (const email of batch) {
        verdicts.push({ id: email.id, classification: "unknown", confidence: 0 });
      }
    }
  }

  return verdicts;
}
