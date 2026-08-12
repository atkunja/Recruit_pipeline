import Link from "next/link";
import { getDashboardSummary, greeting } from "@/lib/dashboard";
import { getRecentActivity } from "@/lib/activity";
import { budgetStatus } from "@/lib/ai/budget";
import { EmptyState, Stat, relativeTime } from "@/components/ui";
import { PrepareBestButton } from "./prepare-best";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const [summary, activity, budget] = await Promise.all([
    getDashboardSummary(),
    getRecentActivity(15),
    budgetStatus(),
  ]);

  const headlines: { label: string; value: number; href: string }[] = [
    { label: "new jobs found", value: summary.newJobsToday, href: "/discover?since=1d" },
    { label: "above 90% fit", value: summary.highFitToday, href: "/discover?minScore=90" },
    { label: "ready for review", value: summary.readyForReview, href: "/queue" },
    { label: "contacts identified", value: summary.contactsIdentified, href: "/outreach" },
    { label: "recruiter responses", value: summary.recruiterResponses, href: "/outreach" },
    { label: "OAs needing action", value: summary.actionRequired, href: "/interviews" },
  ];

  const live = headlines.filter((item) => item.value > 0);

  return (
    <>
      <div className="mb-5 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{greeting()}</h1>
          <div className="mt-2 flex flex-col gap-0.5">
            {live.length === 0 ? (
              <p className="text-muted">
                Nothing new. Run discovery or add a job manually to get started.
              </p>
            ) : (
              live.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="w-fit text-muted transition-colors hover:text-text"
                >
                  <span className="font-semibold tabular-nums text-text">
                    {item.value}
                  </span>{" "}
                  {item.label}
                </Link>
              ))
            )}
          </div>
        </div>

        <PrepareBestButton candidates={summary.topCandidates} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Applied (7d)" value={summary.applicationsThisWeek} />
        <Stat label="Outreach (7d)" value={summary.outreachThisWeek} />
        <Stat label="Open tasks" value={summary.openTasks} />
        <Stat
          label="AI spend (month)"
          value={`$${budget.spent.toFixed(2)}`}
          hint={budget.unlimited ? "no cap set" : `of $${budget.limit.toFixed(2)}`}
          tone={
            !budget.unlimited && budget.spent / budget.limit > 0.8
              ? "warn"
              : "default"
          }
        />
        <Stat label="AI calls (month)" value={budget.callCount} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <h2 className="eyebrow mb-2">Top unprepared opportunities</h2>
          {summary.topCandidates.length === 0 ? (
            <EmptyState
              title="No scored opportunities yet"
              hint="Discovered jobs get scored automatically. You can also add one by hand."
              action={
                <Link
                  href="/jobs/new"
                  className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg"
                >
                  Add a job
                </Link>
              }
            />
          ) : (
            <div className="panel divide-y divide-border">
              {summary.topCandidates.map((candidate) => (
                <Link
                  key={candidate.jobId}
                  href={`/jobs/${candidate.jobId}`}
                  className="row-hover flex items-center gap-3 px-3 py-2"
                >
                  <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-accent">
                    {candidate.score}
                  </span>
                  <span className="shrink-0 font-medium">{candidate.companyName}</span>
                  <span className="truncate text-muted">{candidate.title}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="eyebrow mb-2">Recent activity</h2>
          {activity.length === 0 ? (
            <div className="panel px-3 py-6 text-center text-faint">
              No activity yet.
            </div>
          ) : (
            <div className="panel divide-y divide-border">
              {activity.map((event) => (
                <div key={event.id} className="flex items-baseline gap-2 px-3 py-1.5">
                  <span className="truncate text-muted">{event.message}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-faint">
                    {relativeTime(event.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
