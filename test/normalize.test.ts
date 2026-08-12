import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildDedupeKey,
  canonicalLocationKey,
  detectRemote,
  detectSeason,
  extractSections,
  htmlToText,
  isUnitedStates,
  normalizeTitle,
  parseLocations,
  slugifyCompany,
} from "../src/lib/jobs/normalize.ts";

describe("slugifyCompany", () => {
  test("collapses legal suffixes and punctuation", () => {
    assert.equal(slugifyCompany("Databricks, Inc."), "databricks");
    assert.equal(slugifyCompany("databricks"), "databricks");
    assert.equal(slugifyCompany("DATABRICKS INC"), "databricks");
  });

  test("keeps distinct companies distinct", () => {
    assert.notEqual(slugifyCompany("Ramp"), slugifyCompany("Rampart"));
  });

  test("expands ampersands rather than dropping them", () => {
    assert.equal(slugifyCompany("Ernst & Young"), "ernst-and-young");
  });

  test("strips diacritics", () => {
    assert.equal(slugifyCompany("Société Générale"), slugifyCompany("Societe Generale"));
  });

  test("never returns an empty slug", () => {
    assert.notEqual(slugifyCompany("!!!"), "");
    assert.notEqual(slugifyCompany("株式会社"), "");
  });
});

describe("normalizeTitle", () => {
  test("strips season, year, and parentheticals", () => {
    assert.equal(
      normalizeTitle("Software Engineer Intern (Summer 2027)"),
      "software engineer",
    );
  });

  test("makes two boards' wording of one role converge", () => {
    const a = normalizeTitle("Software Engineering Intern - Backend (Summer 2027)");
    const b = normalizeTitle("Backend Software Engineering Intern, Summer 2027");
    // Same words, and that is what the dedupe key hashes.
    assert.deepEqual([...a.split(" ")].sort(), [...b.split(" ")].sort());
  });

  test("keeps meaningful specialisation", () => {
    assert.match(normalizeTitle("SWE Intern, Cloud Infrastructure"), /cloud/);
    assert.match(normalizeTitle("SWE Intern, Cloud Infrastructure"), /infrastructure/);
  });

  test("falls back to the original when everything is noise", () => {
    assert.equal(normalizeTitle("Intern"), "intern");
    assert.equal(normalizeTitle("Summer 2027"), "summer 2027");
  });
});

describe("buildDedupeKey", () => {
  test("matches the same job seen on two boards", () => {
    const greenhouse = buildDedupeKey(
      "databricks",
      "Software Engineer Intern (Summer 2027)",
      "San Francisco, CA",
    );
    const simplify = buildDedupeKey(
      "databricks",
      "Software Engineer Intern, Summer 2027",
      "San Francisco, CA",
    );
    assert.equal(greenhouse, simplify);
  });

  test("separates the same title in different cities", () => {
    assert.notEqual(
      buildDedupeKey("stripe", "SWE Intern", "Seattle, WA"),
      buildDedupeKey("stripe", "SWE Intern", "New York, NY"),
    );
  });

  test("separates different roles at one company", () => {
    assert.notEqual(
      buildDedupeKey("stripe", "Backend Engineer Intern", "Seattle, WA"),
      buildDedupeKey("stripe", "Frontend Engineer Intern", "Seattle, WA"),
    );
  });

  test("tolerates a missing location", () => {
    assert.equal(typeof buildDedupeKey("stripe", "SWE Intern", null), "string");
  });
});

describe("detectRemote", () => {
  test("detects remote", () => {
    assert.equal(detectRemote("Remote - US"), true);
    assert.equal(detectRemote("Work from home"), true);
  });

  test("treats hybrid as not remote", () => {
    assert.equal(detectRemote("Remote (Hybrid)"), false);
    assert.equal(detectRemote("Hybrid - Seattle"), false);
  });

  test("handles null", () => {
    assert.equal(detectRemote(null), false);
  });
});

describe("isUnitedStates", () => {
  test("accepts US city/state pairs", () => {
    assert.equal(isUnitedStates(["Ann Arbor, MI"]), true);
    assert.equal(isUnitedStates(["New York, NY 10001"]), true);
  });

  test("rejects foreign offices", () => {
    assert.equal(isUnitedStates(["London, United Kingdom"]), false);
    assert.equal(isUnitedStates(["Bengaluru, India"]), false);
    assert.equal(isUnitedStates(["Toronto, Ontario"]), false);
  });

  test("accepts a US location listed alongside a foreign one", () => {
    assert.equal(isUnitedStates(["London, UK", "Seattle, WA"]), true);
  });

  test("is false for no location at all", () => {
    assert.equal(isUnitedStates([]), false);
  });
});

describe("parseLocations", () => {
  test("splits multi-location strings", () => {
    assert.deepEqual(parseLocations("Seattle, WA; New York, NY"), [
      "Seattle, WA",
      "New York, NY",
    ]);
    assert.deepEqual(parseLocations("Austin, TX | Remote"), ["Austin, TX", "Remote"]);
  });

  test("leaves a single location intact, comma and all", () => {
    assert.deepEqual(parseLocations("San Francisco, CA"), ["San Francisco, CA"]);
  });

  test("returns empty for null", () => {
    assert.deepEqual(parseLocations(null), []);
  });
});

describe("detectSeason", () => {
  test("reads the season out of a title", () => {
    assert.equal(detectSeason("SWE Intern, Summer 2027"), "Summer 2027");
    assert.equal(detectSeason("2027 Summer Internship"), "Summer 2027");
  });

  test("prefers the title over the description", () => {
    assert.equal(
      detectSeason("Summer 2027 Intern", "We also run a Fall 2026 program"),
      "Summer 2027",
    );
  });

  test("infers summer from a May–August window", () => {
    assert.equal(
      detectSeason("Engineering Intern", "The program runs May 2027 through August 2027."),
      "Summer 2027",
    );
  });

  test("normalises Autumn to Fall", () => {
    assert.equal(detectSeason("Autumn 2027 Internship"), "Fall 2027");
  });

  test("returns null when the posting never says", () => {
    assert.equal(detectSeason("Software Engineer", null), null);
  });
});

describe("htmlToText", () => {
  test("converts list items to bullets and strips tags", () => {
    const text = htmlToText("<ul><li>Rust</li><li>Go</li></ul>");
    assert.match(text, /• Rust/);
    assert.match(text, /• Go/);
    assert.doesNotMatch(text, /</);
  });

  test("decodes entities", () => {
    assert.equal(htmlToText("<p>R&amp;D &quot;team&quot;</p>"), 'R&D "team"');
  });

  test("drops script contents entirely", () => {
    assert.doesNotMatch(htmlToText("<script>alert(1)</script><p>hi</p>"), /alert/);
  });
});

describe("extractSections", () => {
  test("pulls requirements and preferred apart", () => {
    const description = [
      "About us: we build things.",
      "Basic Qualifications: Pursuing a BS in Computer Science. Experience with Python and distributed systems.",
      "Preferred Qualifications: Familiarity with Kubernetes and Go, plus an interest in developer tooling.",
    ].join("\n\n");

    const { requirements, preferred } = extractSections(description);
    assert.match(String(requirements), /BS in Computer Science/);
    assert.match(String(preferred), /Kubernetes/);
  });

  test("returns null when there are no headings", () => {
    const { requirements, preferred } = extractSections("Just a paragraph.");
    assert.equal(requirements, null);
    assert.equal(preferred, null);
  });
});

describe("isUnitedStates — regression: substring false positives", () => {
  test("Milwaukee is not the United Kingdom", () => {
    // "Mil-w-a-UK-ee" matched the "uk" marker under substring matching, and
    // every Milwaukee posting was silently discarded before scoring.
    assert.equal(isUnitedStates(["Milwaukee, WI"]), true);
    assert.equal(isUnitedStates(["Milwaukee"]), true);
  });

  test("Indianapolis is not India", () => {
    assert.equal(isUnitedStates(["Indianapolis, IN"]), true);
    assert.equal(isUnitedStates(["Indianapolis"]), true);
  });

  test("still excludes the actual foreign places", () => {
    assert.equal(isUnitedStates(["London, UK"]), false);
    assert.equal(isUnitedStates(["Bengaluru, India"]), false);
    assert.equal(isUnitedStates(["Hong Kong, Hong Kong"]), false);
    assert.equal(isUnitedStates(["Amsterdam, Netherlands"]), false);
  });
});

describe("isUnitedStates — accepts real-world US formats", () => {
  test("full state names", () => {
    assert.equal(isUnitedStates(["Chicago, Illinois"]), true);
    assert.equal(isUnitedStates(["Austin, Texas"]), true);
  });

  test("a bare state", () => {
    assert.equal(isUnitedStates(["Texas"]), true);
  });

  test("city shorthands with no state", () => {
    for (const location of ["NYC", "SF", "New York", "Bay Area", "Seattle", "Boston"]) {
      assert.equal(isUnitedStates([location]), true, location);
    }
  });

  test("multi-city strings", () => {
    assert.equal(isUnitedStates(parseLocations("Chicago; New York")), true);
  });

  test("a US city alongside a foreign one still counts", () => {
    assert.equal(isUnitedStates(["London, UK", "Chicago, IL"]), true);
  });
});

describe("canonicalLocationKey", () => {
  test("collapses the many spellings of one city", () => {
    const sf = canonicalLocationKey("San Francisco, CA");
    for (const variant of ["SF", "san francisco", "San Francisco, California", "Bay Area"]) {
      assert.equal(canonicalLocationKey(variant), sf, variant);
    }
  });

  test("collapses New York spellings", () => {
    const ny = canonicalLocationKey("New York, NY");
    for (const variant of ["NYC", "Brooklyn", "Manhattan, NY"]) {
      assert.equal(canonicalLocationKey(variant), ny, variant);
    }
  });

  test("keeps genuinely different cities apart", () => {
    assert.notEqual(canonicalLocationKey("Seattle, WA"), canonicalLocationKey("Austin, TX"));
  });

  test("treats remote as its own place", () => {
    assert.equal(canonicalLocationKey("Remote - US"), "remote");
  });

  test("handles absence", () => {
    assert.equal(canonicalLocationKey(null), "");
    assert.equal(canonicalLocationKey(""), "");
  });
});

describe("buildDedupeKey — cross-board matching", () => {
  test("one posting listed two ways on two boards collapses", () => {
    // The real case: Sentry's Summer 2027 internship appeared twice on
    // Discover because the titles were punctuated differently and one board
    // said "SF" while the other said "San Francisco, CA".
    assert.equal(
      buildDedupeKey("sentry", "Software Engineer, Intern (Summer 2027)", "San Francisco, CA"),
      buildDedupeKey("sentry", "Software Engineer Intern - Summer 2027", "SF"),
    );
  });

  test("the same role in two cities stays separate", () => {
    assert.notEqual(
      buildDedupeKey("sentry", "Software Engineer Intern", "San Francisco, CA"),
      buildDedupeKey("sentry", "Software Engineer Intern", "Seattle, WA"),
    );
  });
});
