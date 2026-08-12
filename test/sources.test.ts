import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isTitleInteresting } from "../src/lib/sources/registry.ts";
import { stripTracking } from "../src/lib/sources/simplify.ts";
import { candidateSlugs } from "../src/lib/sources/board-discovery.ts";
import { parseBatchYear } from "../src/lib/sources/ycombinator.ts";

describe("isTitleInteresting", () => {
  test("keeps technical internships", () => {
    for (const title of [
      "Software Engineer Intern",
      "Backend Engineering Intern, Summer 2027",
      "Infrastructure Engineering Intern",
      "Quantitative Developer Intern",
      "Robotics Software Intern",
      "Developer Infrastructure Intern",
      "Machine Learning Intern",
      "SWE Co-op",
    ]) {
      assert.equal(isTitleInteresting(title), true, title);
    }
  });

  test("drops non-technical internships", () => {
    for (const title of [
      "Marketing Intern",
      "Human Resources Intern",
      "Finance Summer Analyst",
      "Legal Intern",
    ]) {
      assert.equal(isTitleInteresting(title), false, title);
    }
  });

  test("drops full-time engineering roles", () => {
    for (const title of [
      "Senior Software Engineer",
      "Staff Software Engineer - Database Engine Internals",
      "Engineering Manager, Platform",
    ]) {
      assert.equal(isTitleInteresting(title), false, title);
    }
  });

  test("does not treat 'Internals' as 'intern'", () => {
    // The word boundary here is the difference between 1 and 8 false hits on a
    // single large board.
    assert.equal(isTitleInteresting("Software Engineer - Database Internals"), false);
  });
});

describe("stripTracking", () => {
  test("removes tracking parameters so a URL stays stable", () => {
    assert.equal(
      stripTracking("https://example.com/job/1?utm_source=Simplify&utm_medium=x"),
      "https://example.com/job/1",
    );
  });

  test("keeps parameters the posting actually needs", () => {
    assert.equal(
      stripTracking("https://example.com/apply?gh_jid=123&utm_source=Simplify"),
      "https://example.com/apply?gh_jid=123",
    );
  });

  test("passes through a URL it cannot parse", () => {
    assert.equal(stripTracking("not a url"), "not a url");
  });
});

describe("candidateSlugs", () => {
  test("derives slugs from the name and website", () => {
    const slugs = candidateSlugs({
      externalKey: "yc:acme",
      name: "Acme Robotics, Inc.",
      website: "https://www.acmerobotics.com",
      slugHints: ["acme-robotics"],
    });

    assert.ok(slugs.includes("acme-robotics"));
    assert.ok(slugs.includes("acmerobotics"));
  });

  test("puts explicit hints first", () => {
    const slugs = candidateSlugs({
      externalKey: "yc:x",
      name: "Some Long Company Name",
      slugHints: ["short"],
    });
    assert.equal(slugs[0], "short");
  });

  test("is bounded so one company can't fan out into many probes", () => {
    const slugs = candidateSlugs({
      externalKey: "yc:x",
      name: "A B C D E",
      website: "https://abcde.com",
      slugHints: ["a", "bb", "ccc", "dddd", "eeeee"],
    });
    assert.ok(slugs.length <= 4);
  });
});

describe("parseBatchYear", () => {
  test("reads long-form batches", () => {
    assert.equal(parseBatchYear("Winter 2012"), 2012);
    assert.equal(parseBatchYear("Summer 2021"), 2021);
  });

  test("reads short-form batches", () => {
    assert.equal(parseBatchYear("W12"), 2012);
    assert.equal(parseBatchYear("S21"), 2021);
  });

  test("returns null when absent", () => {
    assert.equal(parseBatchYear(undefined), null);
    assert.equal(parseBatchYear("unknown"), null);
  });
});
