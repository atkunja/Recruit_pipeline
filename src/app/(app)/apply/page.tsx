import Link from "next/link";
import { sql } from "@/lib/db";
import { loadProfileContext } from "@/lib/profile/context";
import { EmptyState, PageHeader } from "@/components/ui";
import { ApplyDeck } from "./deck";

export const dynamic = "force-dynamic";

/**
 * Apply mode.
 *
 * A launcher, not an autofiller. Browser extensions already fill name, email,
 * school and links across more ATSes than a Playwright script reasonably can —
 * what they cannot do is produce a resume tailored to *this* posting, or answer
 * the essay questions autofill always leaves blank.
 *
 * So this screen holds one job at a time and puts everything the extension
 * can't supply one keystroke away: the tailored PDF, the prepared answers, and
 * the profile facts, each copyable. Then it records the application and
 * advances.
 */
export default async function ApplyPage() {
  const [context, rows] = await Promise.all([
    loadProfileContext().catch(() => null),
    sql<
      {
        applicationId: number;
        jobId: number;
        title: string;
        url: string;
        companyName: string;
        locationRaw: string | null;
        payLabel: string | null;
        score: number | null;
        resumeVersionId: number | null;
        resumeApproved: boolean;
        resumeIntegrityOk: boolean;
        status: string;
      }[]
    >`
      select
        a.id            as application_id,
        j.id            as job_id,
        j.title,
        j.url,
        c.name          as company_name,
        j.location_raw,
        j.pay_raw       as pay_label,
        a.status::text  as status,
        r.id            as resume_version_id,
        coalesce(r.approved, false)     as resume_approved,
        coalesce(r.integrity_ok, false) as resume_integrity_ok,
        (
          select total from job_scores s
          where s.job_id = j.id order by s.created_at desc limit 1
        )               as score
      from applications a
      join jobs j      on j.id = a.job_id
      join companies c on c.id = j.company_id
      left join resume_versions r on r.id = a.resume_version_id
      where a.status in ('preparing', 'ready_to_apply')
      order by a.priority desc, coalesce(
        (select total from job_scores s where s.job_id = j.id order by s.created_at desc limit 1),
        0
      ) desc
    `,
  ]);

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Apply" subtitle="Nothing queued." />
        <EmptyState
          title="No applications prepared"
          hint="Prepare a job from Discover and it lands here with a tailored resume and prepared answers, ready to work through one at a time."
          action={
            <Link
              href="/discover"
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg"
            >
              Go to Discover
            </Link>
          }
        />
      </>
    );
  }

  interface QuestionRow {
    applicationId: number;
    id: number;
    question: string;
    answer: string | null;
    needsReview: boolean;
    isSensitive: boolean;
  }

  const questionRows = await sql<QuestionRow[]>`
    select application_id, id, question, answer, needs_review, is_sensitive
    from application_questions
    where application_id = any(${rows.map((row) => row.applicationId)})
    order by id asc
  `;

  const byApplication = new Map<number, QuestionRow[]>();
  for (const question of questionRows) {
    const list = byApplication.get(question.applicationId) ?? [];
    list.push(question);
    byApplication.set(question.applicationId, list);
  }

  const profile = context?.profile ?? null;

  return (
    <>
      <PageHeader
        title="Apply"
        subtitle={`${rows.length} prepared · work through them one at a time`}
      />

      <ApplyDeck
        jobs={rows.map((row) => ({
          applicationId: row.applicationId,
          jobId: row.jobId,
          title: row.title,
          url: row.url,
          company: row.companyName,
          location: row.locationRaw,
          pay: row.payLabel,
          score: row.score,
          resumeVersionId: row.resumeVersionId,
          resumeReady: row.resumeApproved && row.resumeIntegrityOk,
          questions: (byApplication.get(row.applicationId) ?? []).map((question) => ({
            id: question.id,
            question: question.question,
            answer: question.answer,
            needsReview: question.needsReview,
            isSensitive: question.isSensitive,
          })),
        }))}
        profile={
          profile === null
            ? null
            : {
                fullName: profile.fullName,
                email: profile.email,
                phone: profile.phone,
                location: profile.location,
                university: profile.university,
                degree: `${profile.degree}, ${profile.major}`,
                graduation: profile.graduationDate.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }),
                gpa: profile.gpa,
                github: profile.githubUrl,
                linkedin: profile.linkedinUrl,
                portfolio: profile.portfolioUrl,
                workAuthorization: profile.workAuthorization,
                sponsorship: profile.needsSponsorship ? "Yes" : "No",
              }
        }
      />
    </>
  );
}
