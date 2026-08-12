import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { complete, modelFor } from "../ai/client";
import { loadProfileContext } from "../profile/context";
import { getJobDetail } from "../jobs/repository";
import { getContact } from "../contacts/repository";
import { logActivity } from "../activity";
import type { OutreachKind, OutreachMessage } from "../types";

/**
 * Outreach drafting.
 *
 * Same rule as the resume: the message may only use verified facts. It is also
 * held to a length — a student's cold email to a recruiter works when it is
 * short, specific and easy to reply to, and fails when it reads like a cover
 * letter.
 *
 * Nothing is sent here. This writes a draft with status 'draft'.
 */

const ResponseSchema = z.object({
  subject: z.string().min(3).max(120),
  body: z.string().min(40),
  rationale: z.string().optional(),
});

const SYSTEM_PROMPT = `You write a short cold email from a student to someone at a company they are applying to.

Hard rules:
- Use ONLY facts from the candidate record given to you. Never invent a project, a metric, a technology, a class, or a mutual connection.
- If there is no genuine shared connection, do not manufacture one.
- 90-130 words in the body. Four short paragraphs at most.
- No "I hope this email finds you well", no "I am reaching out to express my strong interest", no "passionate", no "leverage", no "synergy". Write the way a competent person actually writes.
- Be concrete: name the role, name one specific relevant thing the candidate built, and ask one specific easy question.
- End with a low-friction ask (a quick question, or whether they're the right person to talk to) — not "I would love the opportunity to discuss further at your earliest convenience".
- Subject line: 3-7 words, specific, no clickbait, no emoji.
- Sign off with the candidate's first name only.

You are writing to a real person who gets many of these. Earn the reply.`;

export interface GenerateOutreachInput {
  contactId: number;
  jobId: number;
  applicationId?: number | null;
  kind?: OutreachKind;
  /** Extra steer from the user, e.g. "mention I'm at their booth Thursday". */
  instruction?: string | null;
}

export async function generateOutreach(
  input: GenerateOutreachInput,
): Promise<OutreachMessage> {
  const [contact, job, context] = await Promise.all([
    getContact(input.contactId),
    getJobDetail(input.jobId),
    loadProfileContext(),
  ]);

  if (!contact) throw new Error(`No contact ${input.contactId}`);
  if (!job) throw new Error(`No job ${input.jobId}`);

  const kind = input.kind ?? "initial";

  // Refuse to draft a second initial email to the same person about the same
  // role. The database enforces this for sends; catching it here means the
  // user never even sees a draft that would be blocked.
  if (kind === "initial") {
    const existing = await sql<{ id: number }[]>`
      select id from outreach_messages
      where contact_id = ${input.contactId}
        and job_id = ${input.jobId}
        and kind = 'initial'
        and status = 'sent'
      limit 1
    `;
    if (existing[0]) {
      throw new Error(
        `You already emailed ${contact.name} about this role. Draft a follow-up instead.`,
      );
    }
  }

  const application = input.applicationId ?? null;
  const hasApplied = application !== null
    ? await sql<{ status: string }[]>`
        select status from applications where id = ${application}
      `.then((rows) =>
        rows[0] !== undefined &&
        ["applied", "outreach_sent", "oa", "interview"].includes(rows[0].status),
      )
    : false;

  const priorMessages =
    kind === "follow_up"
      ? await sql<{ subject: string; body: string; sentAt: Date | null }[]>`
          select subject, body, sent_at from outreach_messages
          where contact_id = ${input.contactId} and status = 'sent'
          order by sent_at desc limit 2
        `
      : [];

  const response = await complete({
    purpose: "outreach",
    tier: "strong",
    system: SYSTEM_PROMPT,
    user: buildPrompt({
      contact,
      job,
      context,
      kind,
      hasApplied,
      priorMessages,
      instruction: input.instruction ?? null,
    }),
    schema: ResponseSchema,
    schemaName: "OutreachDraft",
    temperature: 0.6,
    maxOutputTokens: 700,
    jobId: input.jobId,
  });

  const rows = await sql<OutreachMessage[]>`
    insert into outreach_messages (
      contact_id, application_id, job_id, kind, subject, body, status, model
    ) values (
      ${input.contactId}, ${application}, ${input.jobId}, ${kind},
      ${response.subject}, ${response.body}, 'draft', ${modelFor("strong")}
    )
    returning *
  `;

  const message = rows[0];
  if (!message) throw new Error("Failed to save outreach draft");

  await logActivity({
    kind: "outreach_drafted",
    message: `Drafted ${kind === "follow_up" ? "follow-up" : "outreach"} to ${contact.name}`,
    contactId: contact.id,
    applicationId: application,
    jobId: input.jobId,
  });

  return message;
}

function buildPrompt(args: {
  contact: NonNullable<Awaited<ReturnType<typeof getContact>>>;
  job: NonNullable<Awaited<ReturnType<typeof getJobDetail>>>;
  context: Awaited<ReturnType<typeof loadProfileContext>>;
  kind: OutreachKind;
  hasApplied: boolean;
  priorMessages: { subject: string; body: string; sentAt: Date | null }[];
  instruction: string | null;
}): string {
  const { contact, job, context, kind, hasApplied, priorMessages, instruction } = args;
  const { profile, experiences, bullets, skills } = context;

  const parts: string[] = [];

  parts.push("CANDIDATE (the only facts you may use):");
  parts.push(
    `${profile.fullName}, ${profile.degree} in ${profile.major} at ${profile.university}, graduating ${profile.graduationDate.getUTCFullYear()}.`,
  );
  if (profile.summary) parts.push(profile.summary);
  parts.push(`Skills: ${skills.map((skill) => skill.name).join(", ")}`);

  parts.push("\nMost relevant things the candidate has actually built:");
  // The three strongest bullets are enough context; the model only needs one.
  const strongest = [...bullets].sort((a, b) => b.strength - a.strength).slice(0, 6);
  for (const bullet of strongest) {
    const experience = experiences.find((item) => item.id === bullet.experienceId);
    parts.push(
      `- (${experience?.organization ?? "project"}) ${bullet.canonicalText}`,
    );
  }

  parts.push("\nRECIPIENT:");
  parts.push(`${contact.name}${contact.title ? `, ${contact.title}` : ""} at ${job.companyName}`);
  parts.push(`Their likely role in hiring: ${contact.category.replace(/_/g, " ")}`);
  if (contact.relevanceReason) parts.push(`Context: ${contact.relevanceReason}`);
  if (contact.isAlum) {
    parts.push(
      `They also attended ${profile.university} — this is a genuine shared connection and may be mentioned.`,
    );
  }

  parts.push("\nROLE:");
  parts.push(`${job.title} at ${job.companyName}${job.locationRaw ? ` (${job.locationRaw})` : ""}`);
  if (job.description) {
    parts.push(`What the role involves: ${job.description.slice(0, 1200)}`);
  }

  parts.push(
    `\nThe candidate has ${hasApplied ? "ALREADY APPLIED" : "NOT yet applied"} to this role.`,
  );
  if (hasApplied) {
    parts.push("Reference the application briefly; do not ask them how to apply.");
  }

  if (kind === "follow_up") {
    parts.push(
      "\nThis is a FOLLOW-UP. Be shorter than the original — 60-80 words. Do not repeat the pitch. Add one new concrete detail or ask one clear question. Do not express disappointment or urgency.",
    );
    for (const prior of priorMessages) {
      parts.push(`\nPreviously sent (${prior.sentAt?.toDateString() ?? "unknown"}):`);
      parts.push(`Subject: ${prior.subject}`);
      parts.push(prior.body.slice(0, 700));
    }
  }

  if (instruction) parts.push(`\nAdditional instruction from the candidate: ${instruction}`);

  parts.push(
    '\nReturn JSON: {"subject":"...","body":"...","rationale":"one line on the angle you took"}',
  );

  return parts.join("\n");
}
