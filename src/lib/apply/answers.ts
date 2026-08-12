import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { complete } from "../ai/client";
import { loadProfileContext } from "../profile/context";
import { getJobDetail } from "../jobs/repository";
import { getSensitiveAnswers } from "../settings";
import type { ApplicationQuestion, QuestionKind } from "../types";

/**
 * Application question answering.
 *
 * Three rules the rest of the file exists to enforce:
 *
 *   1. Answers use only verified profile facts — same guarantee as the resume.
 *   2. Self-identification questions (race, gender, disability, veteran status)
 *      are NEVER auto-answered. They are stored unanswered and flagged, unless
 *      the user has explicitly saved a preference for that exact question.
 *   3. If the model isn't confident, the question is flagged for review rather
 *      than filled in with something plausible.
 */

/** Questions we must never answer on the user's behalf. */
const SENSITIVE_PATTERNS = [
  /\b(race|ethnicity|ethnic)\b/i,
  /\b(gender|sex|pronoun)\b/i,
  /\b(disab(led|ility)|impairment)\b/i,
  /\b(veteran|military service)\b/i,
  /\b(sexual orientation|lgbt)\b/i,
  /\b(age|date of birth|birth ?date)\b/i,
  /\b(religio(n|us))\b/i,
  /\b(marital status|pregnan)\b/i,
  /\bself[- ]identif/i,
  /\b(criminal|conviction|felony|background check)\b/i,
  /\b(salary|compensation) (expectation|requirement)s?\b|\bdesired (salary|compensation)\b|\bexpected (salary|compensation)\b/i,
];

export function isSensitiveQuestion(question: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(question));
}

/** Best-effort categorisation, used to find reusable prior answers. */
export function classifyQuestion(question: string): QuestionKind {
  const text = question.toLowerCase();
  if (isSensitiveQuestion(question)) return "sensitive";
  if (/why (do you want to work|are you interested in|this company|us)\b/.test(text)) {
    return "why_company";
  }
  if (/why (this|the) (role|position|team|job)/.test(text)) return "why_role";
  if (/(describe|tell us about).*(experience|project|time when|challenge)/.test(text)) {
    return "experience";
  }
  if (/(technolog|language|framework|tool|stack|proficien)/.test(text)) {
    return "technical";
  }
  if (/(start date|available|authoriz|sponsor|relocat|location|visa|graduat)/.test(text)) {
    return "logistics";
  }
  return "other";
}

const AnswerSchema = z.object({
  answers: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      /** 0..1 — below 0.7 we flag rather than fill. */
      confidence: z.number().min(0).max(1),
      /** True when the model had to reach beyond the verified record. */
      neededUnverifiedInfo: z.boolean().default(false),
    }),
  ),
});

const SYSTEM_PROMPT = `You answer job application questions for one specific candidate, using ONLY the verified candidate record you are given.

Rules:
- Never state a fact that is not in the record. No invented projects, coursework, metrics, technologies, or interests.
- If you cannot answer from the record, set confidence below 0.5 and say plainly what is missing in the answer field. Do not guess.
- Write in the candidate's voice: direct, specific, first person, no corporate filler. No "I am passionate about", no "I would love the opportunity", no "leverage".
- Match the expected length. A short-answer box wants 2-4 sentences, not an essay.
- For "why this company" and "why this role", cite something concrete from the job description and connect it to something concrete the candidate has actually done.
- Set neededUnverifiedInfo to true if answering properly would require information the record does not contain.`;

export interface GenerateAnswersInput {
  applicationId: number;
  questions: { question: string; maxLength?: number }[];
}

export interface GeneratedAnswer {
  question: string;
  answer: string | null;
  kind: QuestionKind;
  isSensitive: boolean;
  needsReview: boolean;
  source: "ai" | "manual" | "reused";
  reason?: string;
}

export async function generateAnswers(
  input: GenerateAnswersInput,
): Promise<GeneratedAnswer[]> {
  const applications = await sql<{ id: number; jobId: number }[]>`
    select id, job_id from applications where id = ${input.applicationId}
  `;
  const application = applications[0];
  if (!application) throw new Error(`No application ${input.applicationId}`);

  const [job, context, savedSensitive] = await Promise.all([
    getJobDetail(application.jobId),
    loadProfileContext(),
    getSensitiveAnswers(),
  ]);
  if (!job) throw new Error("Job not found");

  const results: GeneratedAnswer[] = [];
  const needsModel: { question: string; maxLength?: number }[] = [];

  for (const item of input.questions) {
    const kind = classifyQuestion(item.question);

    // --- sensitive: never auto-answered ---------------------------------
    if (kind === "sensitive") {
      const saved = savedSensitive[normalizeQuestion(item.question)];
      results.push({
        question: item.question,
        answer: saved ?? null,
        kind,
        isSensitive: true,
        needsReview: saved === undefined,
        source: saved === undefined ? "ai" : "manual",
        reason:
          saved === undefined
            ? "Self-identification or compensation question — left blank for you to answer."
            : "Filled from your saved preference.",
      });
      continue;
    }

    // --- reuse a prior answer to the same question -----------------------
    const prior = await findPriorAnswer(item.question, kind);
    if (prior !== null) {
      results.push({
        question: item.question,
        answer: prior.answer,
        kind,
        isSensitive: false,
        needsReview: false,
        source: "reused",
        reason: "Reused your previously approved answer to this question.",
      });
      continue;
    }

    needsModel.push(item);
  }

  if (needsModel.length > 0) {
    const response = await complete({
      purpose: "answers",
      tier: "strong",
      system: SYSTEM_PROMPT,
      user: buildPrompt(needsModel, job, context),
      schema: AnswerSchema,
      schemaName: "ApplicationAnswers",
      temperature: 0.4,
      maxOutputTokens: 400 + needsModel.length * 260,
      jobId: application.jobId,
    });

    const byQuestion = new Map(
      response.answers.map((answer) => [normalizeQuestion(answer.question), answer]),
    );

    for (const item of needsModel) {
      const answer = byQuestion.get(normalizeQuestion(item.question));
      const kind = classifyQuestion(item.question);

      if (answer === undefined) {
        results.push({
          question: item.question,
          answer: null,
          kind,
          isSensitive: false,
          needsReview: true,
          source: "ai",
          reason: "The model did not return an answer for this question.",
        });
        continue;
      }

      // Low confidence, or an admission that it needed facts we don't have:
      // flag rather than submit something invented.
      const flag = answer.confidence < 0.7 || answer.neededUnverifiedInfo;

      results.push({
        question: item.question,
        answer: answer.answer,
        kind,
        isSensitive: false,
        needsReview: flag,
        source: "ai",
        reason: flag
          ? answer.neededUnverifiedInfo
            ? "Answering this properly needs information that isn't in your profile."
            : "The model wasn't confident — please check this one."
          : undefined,
      });
    }
  }

  await persist(input.applicationId, results);
  return results;
}

async function persist(
  applicationId: number,
  answers: GeneratedAnswer[],
): Promise<void> {
  for (const answer of answers) {
    await sql`
      insert into application_questions (
        application_id, question, answer, kind, is_sensitive, needs_review, source
      ) values (
        ${applicationId}, ${answer.question}, ${answer.answer}, ${answer.kind},
        ${answer.isSensitive}, ${answer.needsReview}, ${answer.source}
      )
      on conflict do nothing
    `;
  }
}

/**
 * A previously approved answer to substantially the same question.
 * Consistency across applications matters — and a reused answer is free.
 */
async function findPriorAnswer(
  question: string,
  kind: QuestionKind,
): Promise<{ answer: string } | null> {
  // "Why do you want to work here" is company-specific; never reuse it.
  if (kind === "why_company" || kind === "why_role") return null;

  const rows = await sql<{ answer: string }[]>`
    select answer from application_questions
    where lower(question) = ${question.toLowerCase()}
      and approved
      and answer is not null
      and not is_sensitive
    order by updated_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").replace(/[?:.]+$/, "").trim();
}

function buildPrompt(
  questions: { question: string; maxLength?: number }[],
  job: NonNullable<Awaited<ReturnType<typeof getJobDetail>>>,
  context: Awaited<ReturnType<typeof loadProfileContext>>,
): string {
  const { profile, experiences, bullets, skills } = context;
  const parts: string[] = [];

  parts.push("VERIFIED CANDIDATE RECORD (the only facts you may use):");
  parts.push(
    `${profile.fullName}. ${profile.degree} in ${profile.major} at ${profile.university}, graduating ${profile.graduationDate.getUTCFullYear()}.` +
      (profile.gpa ? ` GPA ${profile.gpa}.` : ""),
  );
  parts.push(
    `Work authorization: ${profile.workAuthorization}. Needs sponsorship: ${profile.needsSponsorship ? "yes" : "no"}.`,
  );
  if (profile.summary) parts.push(profile.summary);
  parts.push(`Skills: ${skills.map((skill) => skill.name).join(", ")}`);

  parts.push("\nExperience:");
  for (const experience of experiences) {
    parts.push(`- ${experience.title} @ ${experience.organization} (${experience.kind})`);
    for (const bullet of bullets.filter((item) => item.experienceId === experience.id)) {
      parts.push(`    ${bullet.canonicalText}`);
    }
  }

  parts.push(`\nAPPLYING TO: ${job.title} at ${job.companyName}`);
  if (job.description) {
    parts.push(`Job description:\n${job.description.slice(0, 3000)}`);
  }

  parts.push("\nQUESTIONS:");
  for (const item of questions) {
    parts.push(
      `- ${item.question}${item.maxLength ? ` (max ${item.maxLength} characters)` : ""}`,
    );
  }

  parts.push(
    '\nReturn JSON: {"answers":[{"question":"the question verbatim","answer":"...","confidence":0.0,"neededUnverifiedInfo":false}]}',
  );

  return parts.join("\n");
}

export async function listQuestions(
  applicationId: number,
): Promise<ApplicationQuestion[]> {
  return sql<ApplicationQuestion[]>`
    select * from application_questions
    where application_id = ${applicationId}
    order by
      case when needs_review then 0 else 1 end,
      id asc
  `;
}

export async function updateAnswer(
  questionId: number,
  answer: string,
  approve: boolean,
): Promise<void> {
  await sql`
    update application_questions set
      answer       = ${answer},
      source       = 'manual',
      needs_review = false,
      approved     = ${approve},
      updated_at   = now()
    where id = ${questionId}
  `;
}

/** Questions a technical internship application almost always asks. */
export const COMMON_QUESTIONS: string[] = [
  "Why are you interested in this company?",
  "Why are you interested in this position?",
  "Describe a technical project you are proud of.",
  "What technologies and programming languages have you worked with?",
  "What are you looking for in an internship?",
  "Are you legally authorized to work in the United States?",
  "Will you now or in the future require sponsorship for employment visa status?",
  "When would you be available to start?",
];
