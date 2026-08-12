import "server-only";
import { logActivity } from "../activity";
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
}

export async function prepareJob(jobId: number): Promise<PrepareResult> {
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
  };
}
