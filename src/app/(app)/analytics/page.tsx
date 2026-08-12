import {
  breakdownByApplicationSpeed,
  breakdownByCompanyCategory,
  breakdownByOutreach,
  breakdownByScoreBand,
  getFunnelMetrics,
  spendByPurpose,
  weeklyActivity,
  type Breakdown,
} from "@/lib/analytics/metrics";
import { buildInsights, dataGap } from "@/lib/analytics/insights";
import { PageHeader, Panel, Stat, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [
    metrics,
    byCategory,
    byScoreBand,
    byOutreach,
    bySpeed,
    weekly,
    spend,
  ] = await Promise.all([
    getFunnelMetrics(),
    breakdownByCompanyCategory(),
    breakdownByScoreBand(),
    breakdownByOutreach(),
    breakdownByApplicationSpeed(),
    weeklyActivity(),
    spendByPurpose(),
  ]);

  const insights = buildInsights({
    metrics,
    byScoreBand,
    byOutreach,
    bySpeed,
    byCategory,
  });
  const gap = dataGap(metrics);

  const funnel = [
    { label: "Discovered", value: metrics.jobsDiscovered },
    { label: "High fit (85+)", value: metrics.highFitDiscovered },
    { label: "Applied", value: metrics.applicationsSubmitted },
    { label: "OA", value: metrics.oaReceived },
    { label: "Interview", value: metrics.interviewsReached },
    { label: "Offer", value: metrics.offersReceived },
  ];
  const widest = Math.max(...funnel.map((stage) => stage.value), 1);
  const totalSpend = spend.reduce((sum, row) => sum + row.cost, 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Where your applications actually go."
      />

      <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="Response rate"
          value={metrics.responseRate === null ? "—" : `${metrics.responseRate}%`}
          hint={
            metrics.responseRate === null
              ? "not enough outreach yet"
              : `${metrics.repliesReceived} of ${metrics.outreachSent} emails`
          }
        />
        <Stat
          label="OA rate"
          value={metrics.oaRate === null ? "—" : `${metrics.oaRate}%`}
          hint={
            metrics.oaRate === null
              ? "not enough applications yet"
              : `${metrics.oaReceived} of ${metrics.applicationsSubmitted}`
          }
        />
        <Stat
          label="Interview rate"
          value={metrics.interviewRate === null ? "—" : `${metrics.interviewRate}%`}
          hint={metrics.interviewRate === null ? "—" : `${metrics.interviewsReached} reached`}
        />
        <Stat
          label="Offer rate"
          value={metrics.offerRate === null ? "—" : `${metrics.offerRate}%`}
          hint={`${metrics.offersReceived} offer(s)`}
          tone={metrics.offersReceived > 0 ? "good" : "default"}
        />
      </div>

      <section className="mb-5">
        <h2 className="eyebrow mb-2">Insights</h2>
        {insights.length === 0 ? (
          <Panel className="px-3 py-4">
            <p className="text-muted">
              No conclusions yet.{" "}
              {gap ??
                "The numbers so far are too close together to say anything useful."}
            </p>
            <p className="mt-1 text-[11px] text-faint">
              Findings only appear once each group being compared has enough
              applications behind it — a pattern drawn from three data points is
              worse than no pattern at all.
            </p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-2">
            {insights.map((insight) => (
              <Panel key={insight.headline} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{insight.headline}</span>
                  <Tag tone={insight.confidence === "solid" ? "default" : "muted"}>
                    {insight.confidence}
                  </Tag>
                </div>
                <p className="mt-0.5 text-muted">{insight.detail}</p>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="eyebrow mb-2">Funnel</h2>
          <Panel className="p-3">
            <div className="flex flex-col gap-2">
              {funnel.map((stage) => (
                <div key={stage.label}>
                  <div className="flex items-baseline justify-between">
                    <span>{stage.label}</span>
                    <span className="tabular-nums text-muted">{stage.value}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(stage.value / widest) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        <section>
          <h2 className="eyebrow mb-2">Last 12 weeks</h2>
          <Panel className="p-3">
            <div className="flex h-32 items-end gap-1">
              {weekly.map((week) => {
                const max = Math.max(
                  ...weekly.map((item) => Math.max(item.discovered, 1)),
                );
                return (
                  <div
                    key={week.week}
                    className="group flex flex-1 flex-col items-center gap-0.5"
                    title={`${week.week}: ${week.discovered} found, ${week.applied} applied, ${week.outreach} emails`}
                  >
                    <div className="flex w-full flex-1 flex-col justify-end gap-px">
                      <div
                        className="w-full rounded-sm bg-accent/30"
                        style={{ height: `${(week.discovered / max) * 100}%` }}
                      />
                      <div
                        className="w-full rounded-sm bg-accent"
                        style={{ height: `${(week.applied / max) * 100}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-faint">
                      {week.week.split(" ")[1]}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-faint">
              <span className="text-accent/50">■</span> discovered ·{" "}
              <span className="text-accent">■</span> applied
            </p>
          </Panel>
        </section>

        <BreakdownTable title="By fit score" rows={byScoreBand} />
        <BreakdownTable title="By company category" rows={byCategory} />
        <BreakdownTable title="Outreach vs none" rows={byOutreach} />
        <BreakdownTable title="By time to apply" rows={bySpeed} />
      </div>

      <section className="mt-5">
        <h2 className="eyebrow mb-2">AI spend this month</h2>
        <Panel className="p-3">
          {spend.length === 0 ? (
            <p className="text-faint">Nothing spent yet.</p>
          ) : (
            <>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[20px] font-semibold tabular-nums">
                  ${totalSpend.toFixed(2)}
                </span>
                <span className="text-faint">month to date</span>
              </div>
              <div className="flex flex-col gap-1">
                {spend.map((row) => (
                  <div key={row.purpose} className="flex items-baseline gap-2">
                    <span className="w-20 shrink-0 text-muted">{row.purpose}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${totalSpend === 0 ? 0 : (row.cost / totalSpend) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums text-faint">
                      ${row.cost.toFixed(2)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-faint">
                      {row.calls} calls
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      </section>
    </>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <section>
      <h2 className="eyebrow mb-2">{title}</h2>
      <Panel>
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-faint">No applications yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-faint">
                <th className="px-3 py-1.5 font-medium">Group</th>
                <th className="px-3 py-1.5 text-right font-medium">Applied</th>
                <th className="px-3 py-1.5 text-right font-medium">OA</th>
                <th className="px-3 py-1.5 text-right font-medium">Interview</th>
                <th className="px-3 py-1.5 text-right font-medium">OA rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border/60">
                  <td className="px-3 py-1.5">{row.label.replace(/_/g, " ")}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.applications}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.oas}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.interviews}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.oaRate === null ? (
                      <span className="text-faint" title="Too few to be meaningful">
                        —
                      </span>
                    ) : (
                      `${row.oaRate}%`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </section>
  );
}
