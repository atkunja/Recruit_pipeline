import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildInsights, dataGap } from "../src/lib/analytics/insights.ts";
import type { Breakdown, FunnelMetrics } from "../src/lib/analytics/metrics.ts";

/**
 * These tests exist because the failure mode here is silent and harmful:
 * surfacing a confident-sounding conclusion drawn from four applications would
 * make someone change how they job hunt based on noise.
 */

function breakdown(
  label: string,
  applications: number,
  oas: number,
): Breakdown {
  return {
    label,
    applications,
    responses: oas,
    oas,
    interviews: 0,
    oaRate: applications < 5 ? null : Math.round((oas / applications) * 100),
  };
}

const EMPTY_METRICS: FunnelMetrics = {
  jobsDiscovered: 0,
  highFitDiscovered: 0,
  jobsScored: 0,
  applicationsSubmitted: 0,
  outreachSent: 0,
  contactsIdentified: 0,
  repliesReceived: 0,
  oaReceived: 0,
  interviewsReached: 0,
  offersReceived: 0,
  rejections: 0,
  responseRate: null,
  oaRate: null,
  interviewRate: null,
  offerRate: null,
};

function build(overrides: {
  metrics?: Partial<FunnelMetrics>;
  byScoreBand?: Breakdown[];
  byOutreach?: Breakdown[];
  bySpeed?: Breakdown[];
  byCategory?: Breakdown[];
}) {
  return buildInsights({
    metrics: { ...EMPTY_METRICS, ...overrides.metrics },
    byScoreBand: overrides.byScoreBand ?? [],
    byOutreach: overrides.byOutreach ?? [],
    bySpeed: overrides.bySpeed ?? [],
    byCategory: overrides.byCategory ?? [],
  });
}

describe("insights stay quiet without enough data", () => {
  test("no data at all produces nothing", () => {
    assert.deepEqual(build({}), []);
  });

  test("a huge apparent effect on a tiny sample produces nothing", () => {
    // 100% vs 0% — but only 3 applications each.
    const insights = build({
      byOutreach: [breakdown("with outreach", 3, 3), breakdown("no outreach", 3, 0)],
    });
    assert.deepEqual(insights, []);
  });

  test("one group being large doesn't rescue a tiny comparison group", () => {
    const insights = build({
      byOutreach: [breakdown("with outreach", 50, 25), breakdown("no outreach", 2, 0)],
    });
    assert.deepEqual(insights, []);
  });

  test("a small difference on a large sample produces nothing", () => {
    // 30% vs 28% over 100 each — real data, but not a finding.
    const insights = build({
      byOutreach: [breakdown("with outreach", 100, 30), breakdown("no outreach", 100, 28)],
    });
    assert.deepEqual(insights, []);
  });
});

describe("insights appear when the data supports them", () => {
  test("a large effect on an adequate sample is reported as emerging", () => {
    const insights = build({
      byOutreach: [breakdown("with outreach", 10, 5), breakdown("no outreach", 10, 1)],
    });
    assert.equal(insights.length, 1);
    assert.equal(insights[0]?.confidence, "emerging");
    assert.match(insights[0]?.headline ?? "", /reaching out|outreach/i);
  });

  test("the same effect on a big sample is reported as solid", () => {
    const insights = build({
      byOutreach: [breakdown("with outreach", 40, 20), breakdown("no outreach", 40, 4)],
    });
    assert.equal(insights[0]?.confidence, "solid");
  });

  test("a finding that contradicts the obvious hypothesis is still reported", () => {
    // Outreach doing worse should be surfaced, not suppressed.
    const insights = build({
      byOutreach: [breakdown("with outreach", 20, 2), breakdown("no outreach", 20, 10)],
    });
    assert.equal(insights.length, 1);
    assert.match(insights[0]?.detail ?? "", /without outreach/i);
  });

  test("speed is reported when it separates the groups", () => {
    const insights = build({
      bySpeed: [breakdown("within 48h", 15, 8), breakdown("over a week", 15, 1)],
    });
    assert.equal(insights.length, 1);
    assert.match(insights[0]?.headline ?? "", /early/i);
  });

  test("score bands flag a scorer that isn't predicting anything", () => {
    const insights = build({
      byScoreBand: [breakdown("90-100", 20, 1), breakdown("under 70", 20, 8)],
    });
    assert.equal(insights.length, 1);
    assert.match(insights[0]?.headline ?? "", /not predicting/i);
  });

  test("a low overall OA rate is called out once volume justifies it", () => {
    const insights = build({
      metrics: {
        applicationsSubmitted: 50,
        oaReceived: 2,
        oaRate: 4,
      },
    });
    assert.equal(insights.length, 1);
    assert.match(insights[0]?.headline ?? "", /low oa rate/i);
    assert.equal(insights[0]?.confidence, "solid");
  });

  test("the same low rate on few applications says nothing", () => {
    const insights = build({
      metrics: { applicationsSubmitted: 6, oaReceived: 0, oaRate: 0 },
    });
    assert.deepEqual(insights, []);
  });
});

describe("dataGap", () => {
  test("says how many more applications are needed", () => {
    assert.match(String(dataGap({ ...EMPTY_METRICS, applicationsSubmitted: 4 })), /12 more/);
  });

  test("is null once there is enough", () => {
    assert.equal(dataGap({ ...EMPTY_METRICS, applicationsSubmitted: 40 }), null);
  });

  test("uses the singular for one", () => {
    assert.match(
      String(dataGap({ ...EMPTY_METRICS, applicationsSubmitted: 15 })),
      /1 more application\b/,
    );
  });
});
