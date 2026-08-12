import Link from "next/link";
import { listApplications, statusCounts } from "@/lib/applications/repository";
import {
  EmptyState,
  PageHeader,
  ScoreBadge,
  Stat,
  StatusBadge,
  relativeTime,
} from "@/components/ui";
import { APPLICATION_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Everything submitted, and where each one stands. */
export default async function AppliedPage() {
  const [applications, counts] = await Promise.all([
    listApplications([
      "applied",
      "outreach_sent",
      "oa",
      "interview",
      "offer",
      "rejected",
      "withdrawn",
    ]),
    statusCounts(),
  ]);

  const live = applications.filter(
    (item) => !["rejected", "withdrawn"].includes(item.applicationStatus),
  );

  return (
    <>
      <PageHeader
        title="Applied"
        subtitle={`${applications.length} total · ${live.length} still live`}
      />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-6">
        {APPLICATION_STATUSES.filter((status) =>
          ["applied", "oa", "interview", "offer", "rejected", "withdrawn"].includes(
            status,
          ),
        ).map((status) => (
          <Stat
            key={status}
            label={status.replace(/_/g, " ")}
            value={counts[status] ?? 0}
            tone={
              status === "offer"
                ? "good"
                : status === "rejected"
                  ? "danger"
                  : status === "interview" || status === "oa"
                    ? "warn"
                    : "default"
            }
          />
        ))}
      </div>

      {applications.length === 0 ? (
        <EmptyState
          title="No applications yet"
          hint="Mark a job as applied from Discover, or submit one from the Queue."
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {applications.map((item) => (
            <Link
              key={item.applicationId}
              href={`/jobs/${item.id}`}
              className={`panel row-hover flex items-center gap-3 px-3 py-2.5 ${
                ["rejected", "withdrawn"].includes(item.applicationStatus)
                  ? "opacity-55"
                  : ""
              }`}
            >
              <ScoreBadge score={item.score} size="sm" />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{item.companyName}</span>
                  <span className="truncate text-muted">{item.title}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                  <span>
                    {item.appliedAt === null
                      ? "not submitted"
                      : `applied ${relativeTime(item.appliedAt)}`}
                  </span>
                  {item.outreachCount > 0 && (
                    <span>· {item.outreachCount} outreach sent</span>
                  )}
                  {item.nextAction !== null && (
                    <span className="text-warn">· next: {item.nextAction}</span>
                  )}
                </div>
              </div>

              <StatusBadge status={item.applicationStatus} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
