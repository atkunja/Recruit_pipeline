import "server-only";
import { sql } from "../db";
import { logActivity } from "../activity";
import { COMMON_QUESTIONS, generateAnswers } from "../apply/answers";
import { discoverContactsForCompany } from "../contacts/discover";
import { generateOutreach } from "../outreach/generate";
import {
  ensureApplication,
  setResumeVersion,
  setStatus,
} from "../applications/repository";
import { getJobDetail } from "../jobs/repository";
import { loadProfileContext } from "../profile/context";
import { saveResumeVersion } from "../resume/repository";
import { tailorResume } from "../resume/tailor";
import { scoreJob } from "../scoring/score";
import { getScoringWeights } from "../settings";
import type { JobScore } from "../types";

/**
 * Prepare one opportunity end to end.
 *
 * Score (cached), tailor a resume, save it, and move the application into the
 * queue. This is the unit that "Prepare Today's Best" runs in a loop, and the
 * single job "Prepare" button calls directly.
 *
 * Nothing here submits or sends anything. The output is a draft awaiting
 * review, always.
 */

export interface PrepareResult {
  jobId: number;
  applicationId: number;
  resumeVersionId: number;
  score: number;
  integrityOk: boolean;
  integrityIssues: string[];
  fellBackToCanonical: boolean;
  questionsPrepared: number;
  questionsNeedingReview: number;
  contactsFound: number;
  outreachDrafted: number;
  /** Steps that failed without derailing the rest. */
  warnings: string[];
}

export interface PrepareOptions {
  /** Draft answers to the common application questions. One model call. */
  prepareQuestions?: boolean;
  /** Look for contacts and draft outreach to the best one. */
  prepareOutreach?: boolean;
}

export async function prepareJob(
  jobId: number,
  options: PrepareOptions = {},
): Promise<PrepareResult> {
  const { prepareQuestions = true, prepareOutreach = true } = options;
  const warnings: string[] = [];
  const job = await getJobDetail(jobId);
  if (!job) throw new Error(`No job ${jobId}`);

  const [context, weights] = await Promise.all([
    loadProfileContext(),
    getScoringWeights(),
  ]);

  const application = await ensureApplication(jobId, "preparing");
  await setStatus(application.id, "preparing", "Preparing application");

  const score: JobScore = await scoreJob({
    job,
    companyName: job.companyName,
    companyPreference: job.companyPreference,
    context,
    weights,
  });

  const tailored = await tailorResume({
    context,
    job,
    companyName: job.companyName,
    score,
  });

  const version = await saveResumeVersion({
    jobId,
    label: `${job.companyName} — ${job.title}`,
    content: tailored.document,
    bulletIds: tailored.bulletIds,
    rationale: tailored.rationale,
    integrityOk: tailored.integrity.ok,
    integrityIssues: tailored.integrity.issues,
    model: tailored.model,
  });

  await setResumeVersion(application.id, version.id);

  await logActivity({
    kind: "resume_generated",
    message: tailored.fellBackToCanonical
      ? "Resume generated (reworded bullets reverted to verified wording)"
      : "Tailored resume generated",
    jobId,
    applicationId: application.id,
    meta: {
      resumeVersionId: version.id,
      integrityOk: tailored.integrity.ok,
      score: score.total,
    },
  });

  // --- application questions ------------------------------------------------
  let questionsPrepared = 0;
  let questionsNeedingReview = 0;

  if (prepareQuestions) {
    try {
      const answers = await generateAnswers({
        applicationId: application.id,
        questions: COMMON_QUESTIONS.map((question) => ({ question })),
      });
      questionsPrepared = answers.length;
      questionsNeedingReview = answers.filter((a) => a.needsReview).length;
    } catch (error) {
      // A failed question pass must not cost you the resume that already worked.
      warnings.push(
        `Could not prepare application questions: ${message(error)}`,
      );
    }
  }

  // --- contacts and outreach ------------------------------------------------
  let contactsFound = 0;
  let outreachDrafted = 0;

  if (prepareOutreach) {
    try {
      const discovered = await discoverContactsForCompany(job.companyId);
      contactsFound = discovered.created;
    } catch (error) {
      // Contact discovery needs Gmail; its absence is normal, not an error.
      warnings.push(`Could not look for contacts: ${message(error)}`);
    }

    try {
      const best = await bestUncontactedContact(job.companyId, jobId);
      if (best !== null) {
        await generateOutreach({
          contactId: best.id,
          jobId,
          applicationId: application.id,
          kind: "initial",
        });
        outreachDrafted = 1;
      }
    } catch (error) {
      warnings.push(`Could not draft outreach: ${message(error)}`);
    }
  }

  // A resume that failed the integrity check is not ready to send anywhere, so
  // it stays in `preparing` until the user looks at it.
  if (tailored.integrity.ok) {
    await setStatus(application.id, "ready_to_apply", "Resume ready for review");
  }

  return {
    jobId,
    applicationId: application.id,
    resumeVersionId: version.id,
    score: score.total,
    integrityOk: tailored.integrity.ok,
    integrityIssues: tailored.integrity.issues,
    fellBackToCanonical: tailored.fellBackToCanonical,
    questionsPrepared,
    questionsNeedingReview,
    contactsFound,
    outreachDrafted,
    warnings,
  };
}

/**
 * The highest-value contact at this company we have an address for and have
 * not already emailed about this job. Only one — drafting five emails nobody
 * asked for is spend, not help.
 */
async function bestUncontactedContact(
  companyId: number,
  jobId: number,
): Promise<{ id: number } | null> {
  const rows = await sql<{ id: number }[]>`
    select c.id
    from contacts c
    where c.company_id = ${companyId}
      and c.email is not null
      and c.status not in ('do_not_contact', 'bounced')
      and not exists (
        select 1 from outreach_messages o
        where o.contact_id = c.id
          and o.job_id = ${jobId}
          and o.status in ('sent', 'draft', 'approved')
      )
    order by c.outreach_value desc
    limit 1
  `;
  return rows[0] ?? null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
