import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  graduationWindow,
  prefilter,
  requiredYearsOfExperience,
  type PrefilterInput,
  type PrefilterProfile,
} from "../src/lib/jobs/prefilter.ts";

const PROFILE: PrefilterProfile = {
  targetSeason: "Summer 2027",
  graduationDate: new Date("2028-05-01T00:00:00Z"),
};

function job(overrides: Partial<PrefilterInput> = {}): PrefilterInput {
  return {
    title: "Software Engineer Intern",
    description: "Join our backend team for the summer.",
    locationRaw: "Seattle, WA",
    locations: ["Seattle, WA"],
    season: "Summer 2027",
    isActive: true,
    closedAt: null,
    ...overrides,
  };
}

describe("prefilter — passes", () => {
  test("a clean target-season SWE internship", () => {
    const result = prefilter(job(), PROFILE);
    assert.equal(result.verdict, "pass");
    assert.ok(result.reasons.includes("Internship"));
    assert.ok(result.reasons.includes("Technical role"));
  });

  test("an unknown season, because absence is not evidence", () => {
    assert.equal(prefilter(job({ season: null }), PROFILE).verdict, "pass");
  });

  test("a job with no location data at all", () => {
    const result = prefilter(
      job({ locationRaw: null, locations: [] }),
      PROFILE,
    );
    assert.equal(result.verdict, "pass");
  });

  test("remote US roles", () => {
    const result = prefilter(
      job({ locationRaw: "Remote - US", locations: ["Remote - US"] }),
      PROFILE,
    );
    assert.equal(result.verdict, "pass");
    assert.ok(result.reasons.includes("Remote"));
  });

  test("robotics software, which mentions a non-software discipline", () => {
    const result = prefilter(
      job({ title: "Robotics Software Engineer Intern" }),
      PROFILE,
    );
    assert.equal(result.verdict, "pass");
  });

  test("quant developer internships", () => {
    assert.equal(
      prefilter(job({ title: "Quantitative Developer Intern" }), PROFILE).verdict,
      "pass",
    );
  });

  test("an internship only identified as such in the body", () => {
    const result = prefilter(
      job({
        title: "Backend Engineer, Platform",
        description: "This is a 12-week summer internship on our platform team.",
      }),
      PROFILE,
    );
    assert.equal(result.verdict, "pass");
  });
});

describe("prefilter — rejects", () => {
  const rejects = (input: Partial<PrefilterInput>, pattern: RegExp) => {
    const result = prefilter(job(input), PROFILE);
    assert.equal(result.verdict, "reject");
    assert.match(result.reasons.join(" "), pattern);
  };

  test("full-time roles", () => {
    rejects(
      { title: "Senior Software Engineer", description: "5 years required." },
      /Not an internship/,
    );
  });

  test("new grad roles", () => {
    rejects(
      {
        title: "New Graduate Software Engineer",
        description: "For new grads. Our internship program is separate.",
      },
      /not an internship/i,
    );
  });

  test("non-software internships", () => {
    rejects({ title: "Marketing Intern" }, /not a technical software role/i);
    rejects({ title: "Mechanical Engineer Intern" }, /Non-software role/);
    rejects({ title: "Sales Engineer Intern" }, /Non-software role/);
  });

  test("the wrong season", () => {
    rejects({ season: "Summer 2026" }, /Wrong season/);
    rejects({ season: "Fall 2027" }, /Wrong season/);
  });

  test("jobs outside the United States", () => {
    rejects(
      { locationRaw: "London, United Kingdom", locations: ["London, United Kingdom"] },
      /Outside the United States/,
    );
  });

  test("PhD-only postings", () => {
    rejects(
      { description: "PhD candidates only. Must be a PhD student." },
      /graduate or PhD/,
    );
  });

  test("roles wanting real industry experience", () => {
    rejects(
      { description: "Requires 5+ years of professional experience." },
      /5\+ years/,
    );
  });

  test("a graduation window that excludes this profile", () => {
    rejects(
      { description: "Open to students graduating in 2026." },
      /outside required/i,
    );
  });

  test("closed listings", () => {
    rejects({ isActive: false }, /closed/i);
    rejects({ closedAt: new Date() }, /closed/i);
    rejects(
      { description: "We are no longer accepting applications." },
      /says it is closed/,
    );
  });

  test("jobs already applied to", () => {
    rejects({ alreadyApplied: true }, /Already applied/);
  });
});

describe("requiredYearsOfExperience", () => {
  test("reads the plain phrasing", () => {
    assert.equal(requiredYearsOfExperience("3+ years of experience"), 3);
    assert.equal(requiredYearsOfExperience("5 years experience required"), 5);
  });

  test("takes the strictest statement when several appear", () => {
    assert.equal(
      requiredYearsOfExperience("1 year of experience; 4 years of relevant experience"),
      4,
    );
  });

  test("ignores implausible values from company blurbs", () => {
    assert.equal(requiredYearsOfExperience("30 years of experience serving customers"), null);
  });

  test("returns null when unstated", () => {
    assert.equal(requiredYearsOfExperience("We like curious people."), null);
  });
});

describe("graduationWindow", () => {
  test("reads an explicit range", () => {
    assert.deepEqual(
      graduationWindow("Graduating between December 2027 and June 2028"),
      { min: 2027, max: 2028 },
    );
  });

  test("reads a single year", () => {
    assert.deepEqual(graduationWindow("Must be graduating in 2027"), {
      min: 2027,
      max: 2027,
    });
  });

  test("reads class-of phrasing", () => {
    assert.deepEqual(graduationWindow("Class of 2028 preferred"), {
      min: 2028,
      max: 2028,
    });
  });

  test("returns null when unstated", () => {
    assert.equal(graduationWindow("We hire great people."), null);
  });
});
