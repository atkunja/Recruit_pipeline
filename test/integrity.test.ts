import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkIntegrity,
  extractNumbers,
  technologyLikeTokens,
} from "../src/lib/resume/integrity.ts";
import type { ResumeDocument } from "../src/lib/resume/types.ts";
import type { Experience, ResumeBullet, Skill } from "../src/lib/types.ts";

/** Minimal fixtures — only the fields the checker reads. */

const EXPERIENCE = {
  id: 1,
  kind: "internship",
  organization: "Acme Robotics",
  title: "Software Engineering Intern",
  location: "Ann Arbor, MI",
  startDate: new Date("2025-05-01"),
  endDate: new Date("2025-08-01"),
  isCurrent: false,
  description: null,
  technologies: ["Go", "Kubernetes", "PostgreSQL"],
  categories: ["backend"],
  url: null,
  displayOrder: 0,
  verified: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Experience;

const BULLET = {
  id: 10,
  experienceId: 1,
  canonicalText:
    "Built a Go service on Kubernetes that cut p99 latency by 40% across 12 internal endpoints.",
  skills: ["distributed systems"],
  technologies: ["Go", "Kubernetes"],
  metrics: ["40%", "12 endpoints"],
  keywords: ["latency"],
  categories: ["backend"],
  strength: 9,
  verified: true,
  isActive: true,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies ResumeBullet;

const SKILLS = [
  {
    id: 1,
    name: "Go",
    category: "language",
    proficiency: 4,
    years: null,
    verified: true,
    isActive: true,
    displayOrder: 0,
  },
  {
    id: 2,
    name: "Kubernetes",
    category: "tool",
    proficiency: 3,
    years: null,
    verified: true,
    isActive: true,
    displayOrder: 1,
  },
] satisfies Skill[];

function documentWith(text: string, overrides: Partial<ResumeDocument> = {}): ResumeDocument {
  return {
    header: {
      name: "Test Person",
      email: "test@example.com",
      phone: null,
      location: null,
      links: [],
    },
    education: {
      university: "University of Michigan",
      degree: "BSE",
      major: "Computer Science",
      minor: null,
      graduationLabel: "May 2028",
      gpa: "3.8",
    },
    sections: [
      {
        title: "Experience",
        entries: [
          {
            experienceId: 1,
            organization: "Acme Robotics",
            title: "Software Engineering Intern",
            location: "Ann Arbor, MI",
            dateRange: "May 2025 – Aug 2025",
            bullets: [{ bulletId: 10, text, rewritten: true }],
          },
        ],
      },
    ],
    skills: [{ label: "Languages", items: ["Go"] }],
    ...overrides,
  };
}

function check(document: ResumeDocument) {
  return checkIntegrity({
    document,
    bullets: [BULLET],
    experiences: [EXPERIENCE],
    skills: SKILLS,
  });
}

describe("checkIntegrity — accepts legitimate edits", () => {
  test("the canonical bullet, unchanged", () => {
    const report = check(documentWith(BULLET.canonicalText));
    assert.equal(report.ok, true, report.issues.join("\n"));
  });

  test("a shortened rewrite", () => {
    const report = check(
      documentWith("Built a Go service on Kubernetes; cut p99 latency 40%."),
    );
    assert.equal(report.ok, true, report.issues.join("\n"));
  });

  test("a rephrasing that keeps every fact", () => {
    const report = check(
      documentWith(
        "Cut p99 latency by 40% across 12 internal endpoints with a Go service on Kubernetes.",
      ),
    );
    assert.equal(report.ok, true, report.issues.join("\n"));
  });

  test("dropping a metric is fine — removing is not inventing", () => {
    const report = check(documentWith("Built a Go service on Kubernetes."));
    assert.equal(report.ok, true, report.issues.join("\n"));
  });
});

describe("checkIntegrity — catches fabrication", () => {
  test("an inflated metric", () => {
    const report = check(
      documentWith("Built a Go service on Kubernetes that cut p99 latency by 80%."),
    );
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /80%/);
  });

  test("an invented metric where the source had none", () => {
    const report = check(
      documentWith(
        "Built a Go service on Kubernetes serving 5000000 requests per day, cutting p99 latency by 40% across 12 internal endpoints.",
      ),
    );
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /5000000/);
  });

  test("a technology the candidate never used", () => {
    const report = check(
      documentWith("Built a Go service on Kubernetes and Kafka, cutting latency 40%."),
    );
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /Kafka/);
  });

  test("a bullet id that does not exist", () => {
    const document = documentWith(BULLET.canonicalText);
    document.sections[0]!.entries[0]!.bullets[0]!.bulletId = 999;
    const report = check(document);
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /999/);
  });

  test("a bullet moved under the wrong experience", () => {
    const document = documentWith(BULLET.canonicalText);
    document.sections[0]!.entries[0]!.experienceId = 1;
    const report = checkIntegrity({
      document,
      bullets: [{ ...BULLET, experienceId: 2 }],
      experiences: [EXPERIENCE],
      skills: SKILLS,
    });
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /belongs to experience/);
  });

  test("an altered employer name", () => {
    const document = documentWith(BULLET.canonicalText);
    document.sections[0]!.entries[0]!.organization = "Google";
    const report = check(document);
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /does not match verified/);
  });

  test("an altered job title", () => {
    const document = documentWith(BULLET.canonicalText);
    document.sections[0]!.entries[0]!.title = "Senior Staff Engineer";
    const report = check(document);
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /Senior Staff Engineer/);
  });

  test("an unverified skill in the skills section", () => {
    const document = documentWith(BULLET.canonicalText, {
      skills: [{ label: "Languages", items: ["Go", "Rust"] }],
    });
    const report = check(document);
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /Rust/);
  });

  test("the same bullet used twice", () => {
    const document = documentWith(BULLET.canonicalText);
    document.sections[0]!.entries[0]!.bullets.push({
      bulletId: 10,
      text: BULLET.canonicalText,
      rewritten: false,
    });
    const report = check(document);
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /more than once/);
  });

  test("a rewrite that balloons in length", () => {
    const report = check(
      documentWith(
        `${BULLET.canonicalText} Collaborated closely with cross-functional partners across the organisation to deliver measurable business impact and drive alignment on long-term technical strategy.`,
      ),
    );
    assert.equal(report.ok, false);
    assert.match(report.issues.join(" "), /suggests added content/);
  });
});

describe("extractNumbers", () => {
  test("normalises units and separators", () => {
    assert.deepEqual(extractNumbers("cut latency by 40%"), ["40%"]);
    assert.deepEqual(extractNumbers("cut latency by 40 percent"), ["40%"]);
    assert.deepEqual(extractNumbers("served 1,200 users"), ["1200"]);
  });

  test("ignores years", () => {
    assert.deepEqual(extractNumbers("Shipped in 2027"), []);
    assert.deepEqual(extractNumbers("From 2025 to 2026"), []);
  });

  test("finds several values", () => {
    assert.deepEqual(extractNumbers("40% across 12 endpoints"), ["40%", "12"]);
  });
});

describe("technologyLikeTokens", () => {
  test("finds capitalised tools and acronyms", () => {
    const tokens = technologyLikeTokens("Built with Go and gRPC on AWS");
    assert.ok(tokens.includes("Go"));
    assert.ok(tokens.includes("gRPC"));
    assert.ok(tokens.includes("AWS"));
  });

  test("finds punctuated names", () => {
    assert.ok(technologyLikeTokens("Wrote C++ and Node.js").includes("C++"));
    assert.ok(technologyLikeTokens("Wrote C++ and Node.js").includes("Node.js"));
  });

  test("ignores ordinary sentence words", () => {
    const tokens = technologyLikeTokens("Built a service that reduced latency");
    assert.deepEqual(tokens, []);
  });

  test("ignores the leading word of a bullet", () => {
    assert.deepEqual(technologyLikeTokens("Designed a pipeline"), []);
  });
});
