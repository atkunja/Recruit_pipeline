import { sql } from "@/lib/db";
import { getScoringMode, getScoringWeights } from "@/lib/settings";
import { budgetStatus } from "@/lib/ai/budget";
import { loadProfileContext } from "@/lib/profile/context";
import { PageHeader, Panel, Stat } from "@/components/ui";
import { WeightsEditor } from "./weights-editor";
import { SourcesTable } from "./sources-table";
import { ScoringModeControl } from "./scoring-mode";
import type { JobSource } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [weights, budget, sources, spendByPurpose, scoringMode, scoreCounts] = await Promise.all([
    getScoringWeights(),
    budgetStatus(),
    sql<JobSource[]>`
      select * from job_sources order by priority desc, name asc
    `,
    sql<{ purpose: string; cost: string; calls: string }[]>`
      select purpose, sum(cost_usd)::text as cost, count(*)::text as calls
      from ai_usage
      where at >= date_trunc('month', now())
      group by purpose
      order by sum(cost_usd) desc
    `,
    getScoringMode(),
    sql<{ scored: number; unscored: number }[]>`
      select
        (select count(*)::int from job_scores) as scored,
        (select count(*)::int from jobs j
         where j.is_active and j.canonical_job_id is null and not j.is_ignored
           and not exists (select 1 from job_scores s where s.job_id = j.id)
        ) as unscored
    `,
  ]);

  const profile = await loadProfileContext().catch(() => null);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Scoring, discovery sources, and spend."
      />

      <div className="flex flex-col gap-5">
        <section>
          <h2 className="eyebrow mb-2">Profile</h2>
          {profile === null ? (
            <Panel className="p-4">
              <p className="text-danger">
                No profile row found. Fill in <code>db/profile.json</code> and run{" "}
                <code className="text-muted">npm run db:seed</code>.
              </p>
            </Panel>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Stat label="Name" value={profile.profile.fullName} />
              <Stat label="Target" value={profile.profile.targetSeason} />
              <Stat label="Experiences" value={profile.experiences.length} />
              <Stat label="Bullets" value={profile.bullets.length} />
              <Stat label="Skills" value={profile.skills.length} />
            </div>
          )}
        </section>

        <section>
          <h2 className="eyebrow mb-2">AI spend this month</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat
              label="Spent"
              value={`$${budget.spent.toFixed(2)}`}
              hint={budget.unlimited ? "no cap" : `cap $${budget.limit.toFixed(2)}`}
              tone={
                !budget.unlimited && budget.spent / budget.limit > 0.8
                  ? "warn"
                  : "default"
              }
            />
            <Stat label="Calls" value={budget.callCount} />
            {spendByPurpose.slice(0, 2).map((row) => (
              <Stat
                key={row.purpose}
                label={row.purpose}
                value={`$${Number(row.cost).toFixed(2)}`}
                hint={`${row.calls} calls`}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-faint">
            The cap is enforced server-side: once spend reaches it, scoring and
            tailoring return an error instead of spending more. Change it with{" "}
            <code>OPENAI_MONTHLY_BUDGET_USD</code>.
          </p>
        </section>

        <section>
          <h2 className="eyebrow mb-2">Scoring cost</h2>
          <ScoringModeControl
            mode={scoringMode}
            monthlySpend={budget.spent}
            scoredCount={scoreCounts[0]?.scored ?? 0}
            unscoredCount={scoreCounts[0]?.unscored ?? 0}
          />
        </section>

        <section>
          <h2 className="eyebrow mb-2">Scoring weights</h2>
          <WeightsEditor initial={weights} />
        </section>

        <section>
          <h2 className="eyebrow mb-2">Discovery sources</h2>
          <SourcesTable sources={sources} />
        </section>
      </div>
    </>
  );
}
