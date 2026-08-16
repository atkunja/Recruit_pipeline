import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

/**
 * Mirrors the coercion in src/lib/scoring/score.ts.
 *
 * The cheap tier was moved from gpt-4.1-mini to gpt-4.1-nano (5x cheaper per
 * score). The smaller model quotes its numbers — it returned
 * `strongestExperienceIds: ["1"]` — which failed validation, burned three
 * retries and then failed the score outright.
 */
const Numeric = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
});

describe("numeric coercion in model output", () => {
  test("accepts a plain number", () => {
    assert.equal(Numeric.parse(34), 34);
  });

  test("accepts a quoted number, which is what nano returns", () => {
    assert.equal(Numeric.parse("34"), 34);
    assert.deepEqual(z.array(Numeric).parse(["1", "3"]), [1, 3]);
  });

  test("accepts a quoted decimal", () => {
    assert.equal(Numeric.parse("34.5"), 34.5);
  });

  test("falls back to 0 rather than throwing on nonsense", () => {
    // A component that cannot be parsed should score zero, not fail the whole
    // job — the caller clamps into 0..max anyway.
    assert.equal(Numeric.parse("not a number"), 0);
  });

  test("a mixed array still parses", () => {
    assert.deepEqual(z.array(Numeric).parse([1, "2", 3]), [1, 2, 3]);
  });
});
