import Link from "next/link";
import { notFound } from "next/navigation";
import { buildApplicationPackage } from "@/lib/apply/package";
import { getApplicationTimeline } from "@/lib/activity";
import { PageHeader, Panel, Tag, relativeTime } from "@/components/ui";
import { QuestionReview } from "./question-review";

export const dynamic = "force-dynamic";

/**
 * The final review screen.
 *
 * Everything that will be typed into the employer's form, on one page, with
 * every gap called out. This is the screen the whole "prepared, waiting for
 * approval" default exists to put in front of you.
 */
export default async function ApplicationReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const applicationId = Number(id);
  if (!Number.isInteger(applicationId)) notFound();

  const pkg = await buildApplicationPackage(applicationId).catch(() => null);
  if (pkg === null) notFound();

  const timeline = await getApplicationTimeline(applicationId);
  const ready = pkg.blockers.length === 0;

  const supportTone =
    pkg.ats.support === "good"
      ? "text-success"
      : pkg.ats.support === "partial"
        ? "text-warn"
        : "text-faint";

  return (
    <>
      <PageHeader
        title={`${pkg.job.company} — ${pkg.job.title}`}
        subtitle={
          <>
            {pkg.job.location ?? "Location not listed"} ·{" "}
            <span className={supportTone}>
              {pkg.ats.platform} ({pkg.ats.support})
            </span>
          </>
        }
        actions={
          <>
            <Link
              href={`/jobs/${pkg.jobId}`}
              className="rounded-md border border-border px-2.5 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              Job
            </Link>
            <a
              href={pkg.job.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-border px-2.5 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              Open application
            </a>
            {pkg.resume !== null && (
              <a
                href={pkg.resume.pdfPath}
                className="rounded-md bg-accent px-2.5 py-1.5 font-medium text-accent-fg"
              >
                Resume PDF
              </a>
            )}
          </>
        }
      />

      <div
        className={`mb-4 rounded-lg border px-3 py-2.5 ${
          ready
            ? "border-success/30 bg-success-soft"
            : "border-warn/30 bg-warn-soft"
        }`}
      >
        <p className={`font-medium ${ready ? "text-success" : "text-warn"}`}>
          {ready
            ? "Application prepared — ready for you to submit"
            : "Application prepared — waiting on you"}
        </p>
        {pkg.blockers.length > 0 && (
          <ul className="mt-1 flex list-inside list-disc flex-col gap-0.5 text-warn/90">
            {pkg.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[11px] text-muted">
          Nothing is submitted automatically. Run{" "}
          <code className="text-text">npm run apply -- {pkg.applicationId}</code>{" "}
          to have a browser fill what it can, then submit it yourself.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <QuestionReview
            applicationId={pkg.applicationId}
            questions={pkg.questions}
          />

          <Panel className="p-4">
            <h2 className="eyebrow mb-2">Automation coverage</h2>
            <p className="text-muted">{pkg.ats.note}</p>
          </Panel>
        </div>

        <aside className="flex flex-col gap-4">
          <Panel className="p-3">
            <h2 className="eyebrow mb-2">Application details</h2>
            <dl className="flex flex-col gap-1">
              {(
                [
                  ["Name", pkg.profile.fullName],
                  ["Email", pkg.profile.email],
                  ["Phone", pkg.profile.phone],
                  ["Location", pkg.profile.location],
                  ["School", pkg.profile.school],
                  ["Degree", `${pkg.profile.degree}, ${pkg.profile.major}`],
                  ["Graduation", pkg.profile.graduationDate],
                  ["GPA", pkg.profile.gpa],
                  ["Work auth", pkg.profile.workAuthorization],
                  [
                    "Sponsorship",
                    pkg.profile.needsSponsorship ? "Required" : "Not required",
                  ],
                  ["GitHub", pkg.profile.github],
                  ["LinkedIn", pkg.profile.linkedin],
                  ["Portfolio", pkg.profile.portfolio],
                ] as [string, string | null][]
              )
                .filter(([, value]) => value !== null && value !== "")
                .map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <dt className="w-24 shrink-0 text-[11px] text-faint">{label}</dt>
                    <dd className="min-w-0 flex-1 truncate" title={value ?? ""}>
                      {value}
                    </dd>
                  </div>
                ))}
            </dl>
          </Panel>

          <Panel className="p-3">
            <h2 className="eyebrow mb-2">Resume</h2>
            {pkg.resume === null ? (
              <p className="text-danger">No resume generated.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1">
                  {pkg.resume.integrityOk ? (
                    <Tag>integrity ✓</Tag>
                  ) : (
                    <Tag tone="danger">integrity failed</Tag>
                  )}
                  {pkg.resume.approved ? (
                    <Tag>approved</Tag>
                  ) : (
                    <Tag tone="danger">not approved</Tag>
                  )}
                </div>
                <a
                  href={pkg.resume.pdfPath}
                  className="text-accent hover:underline"
                >
                  {pkg.resume.filename}
                </a>
              </div>
            )}
          </Panel>

          {timeline.length > 0 && (
            <Panel className="p-3">
              <h2 className="eyebrow mb-2">Timeline</h2>
              <ol className="flex flex-col gap-1.5">
                {timeline.map((event) => (
                  <li key={event.id} className="flex gap-2">
                    <span className="w-14 shrink-0 text-[11px] text-faint">
                      {new Date(event.at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="min-w-0 flex-1 text-muted">{event.message}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[11px] text-faint">
                Last activity {relativeTime(timeline[timeline.length - 1]?.at ?? null)}
              </p>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
