import Link from "next/link";
import { listApplications } from "@/lib/applications/repository";
import { EmptyState, PageHeader, ScoreBadge, StatusBadge, Tag, relativeTime } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Applications that are prepared but not yet submitted. */
export default async function QueuePage() {
  const applications = await listApplications([
    "preparing",
    "ready_to_apply",
  ]);

  const ready = applications.filter((item) => item.applicationStatus === "ready_to_apply");
  const blocked = applications.filter((item) => item.applicationStatus === "preparing");

  return (
    <>
      <PageHeader
        title="Queue"
        subtitle={
          <>
            <span className="font-medium text-text">{ready.length}</span> ready to
            apply
            {blocked.length > 0 && ` · ${blocked.length} still preparing`}
          </>
        }
      />

      {applications.length === 0 ? (
        <EmptyState
          title="Nothing queued"
          hint="Prepare an opportunity from Discover and it will show up here with a tailored resume waiting for your review."
          action={
            <Link
              href="/discover"
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg"
            >
              Go to Discover
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {applications.map((item) => (
            <Link
              key={item.applicationId}
              href={`/jobs/${item.id}`}
              className="panel row-hover flex items-center gap-3 px-3 py-2.5"
            >
              <ScoreBadge score={item.score} />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{item.companyName}</span>
                  <span className="truncate text-muted">{item.title}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                  <StatusBadge status={item.applicationStatus} />
                  <span>{item.locationRaw ?? "Location not listed"}</span>
                  <span>· updated {relativeTime(item.updatedAt)}</span>
                  {item.hasResume ? (
                    <Tag>resume ready</Tag>
                  ) : (
                    <Tag tone="danger">no resume</Tag>
                  )}
                </div>
              </div>

              <span className="shrink-0 text-[11px] text-accent">Review →</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
