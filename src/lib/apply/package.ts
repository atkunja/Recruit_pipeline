import "server-only";
import { sql } from "../db";
import { getJobDetail } from "../jobs/repository";
import { loadProfileContext } from "../profile/context";
import { getResumeVersion } from "../resume/repository";
import { listQuestions } from "./answers";
import { detectAts, PLATFORM_SUPPORT, type AtsPlatform } from "./ats";
import type { ApplicationStatus } from "../types";

/**
 * Everything needed to fill in one application, in one object.
 *
 * The Playwright CLI fetches this and works entirely from it, so the browser
 * automation has no database access and no credentials beyond the app session.
 */

export interface ApplicationPackage {
  applicationId: number;
  jobId: number;
  status: ApplicationStatus;

  job: {
    title: string;
    company: string;
    url: string;
    location: string | null;
  };

  ats: {
    platform: AtsPlatform;
    support: "good" | "partial" | "none";
    note: string;
  };

  /** Field values, ready to type. */
  profile: {
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string | null;
    location: string | null;
    school: string;
    degree: string;
    major: string;
    graduationDate: string;
    gpa: string | null;
    linkedin: string | null;
    github: string | null;
    portfolio: string | null;
    workAuthorization: string;
    needsSponsorship: boolean;
  };

  resume: {
    versionId: number;
    /** Where the CLI downloads the PDF from. */
    pdfPath: string;
    filename: string;
    approved: boolean;
    integrityOk: boolean;
  } | null;

  questions: {
    id: number;
    question: string;
    answer: string | null;
    needsReview: boolean;
    isSensitive: boolean;
  }[];

  /** Blocking problems. A non-empty list means do not submit. */
  blockers: string[];
}

export async function buildApplicationPackage(
  applicationId: number,
): Promise<ApplicationPackage> {
  const applications = await sql<
    {
      id: number;
      jobId: number;
      status: ApplicationStatus;
      resumeVersionId: number | null;
    }[]
  >`
    select id, job_id, status, resume_version_id
    from applications where id = ${applicationId}
  `;

  const application = applications[0];
  if (!application) throw new Error(`No application ${applicationId}`);

  const [job, context, questions] = await Promise.all([
    getJobDetail(application.jobId),
    loadProfileContext(),
    listQuestions(applicationId),
  ]);
  if (!job) throw new Error("Job not found");

  const resumeVersion =
    application.resumeVersionId === null
      ? null
      : await getResumeVersion(application.resumeVersionId);

  const platform = detectAts(job.url);
  const support = PLATFORM_SUPPORT[platform];

  const { profile } = context;
  const [firstName = profile.fullName, ...rest] = profile.fullName.split(/\s+/);

  const blockers: string[] = [];
  if (resumeVersion === null) {
    blockers.push("No resume has been generated for this application.");
  } else {
    if (!resumeVersion.integrityOk) {
      blockers.push(
        "The tailored resume failed its integrity check and must be regenerated.",
      );
    }
    if (!resumeVersion.approved) {
      blockers.push("The tailored resume has not been approved yet.");
    }
  }

  const unanswered = questions.filter(
    (question) => question.needsReview || question.answer === null,
  );
  if (unanswered.length > 0) {
    blockers.push(
      `${unanswered.length} question(s) still need your input.`,
    );
  }

  return {
    applicationId,
    jobId: application.jobId,
    status: application.status,
    job: {
      title: job.title,
      company: job.companyName,
      url: job.url,
      location: job.locationRaw,
    },
    ats: {
      platform,
      support: support.level,
      note: support.note,
    },
    profile: {
      firstName,
      lastName: rest.join(" "),
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      school: profile.university,
      degree: profile.degree,
      major: profile.major,
      graduationDate: formatGraduation(profile.graduationDate),
      gpa: profile.gpa,
      linkedin: profile.linkedinUrl,
      github: profile.githubUrl,
      portfolio: profile.portfolioUrl,
      workAuthorization: profile.workAuthorization,
      needsSponsorship: profile.needsSponsorship,
    },
    resume:
      resumeVersion === null
        ? null
        : {
            versionId: resumeVersion.id,
            pdfPath: `/api/resume/${resumeVersion.id}/pdf?download=1`,
            filename: `${profile.fullName.replace(/\s+/g, "_")}_Resume.pdf`,
            approved: resumeVersion.approved,
            integrityOk: resumeVersion.integrityOk,
          },
    questions: questions.map((question) => ({
      id: question.id,
      question: question.question,
      answer: question.answer,
      needsReview: question.needsReview,
      isSensitive: question.isSensitive,
    })),
    blockers,
  };
}

function formatGraduation(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
