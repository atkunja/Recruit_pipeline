import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency, phaseDeadlines } from "../src/lib/concurrency.ts";

describe("mapWithConcurrency", () => {
  test("returns results in input order", async () => {
    const settled = await mapWithConcurrency([3, 1, 2], 3, async (n) => {
      await new Promise((r) => setTimeout(r, n * 10));
      return n * 10;
    });
    assert.deepEqual(settled.map((s) => s.value), [30, 10, 20]);
  });

  test("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return true;
    });
    assert.ok(peak <= 4, `peak concurrency was ${peak}`);
  });

  test("one failure does not tear down the batch", async () => {
    const settled = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    assert.equal(settled[0]?.ok, true);
    assert.equal(settled[1]?.ok, false);
    assert.equal(settled[2]?.ok, true);
    assert.match(String((settled[1]?.error as Error).message), /boom/);
  });

  test("stops starting work after the deadline and marks the rest skipped", async () => {
    const settled = await mapWithConcurrency(
      Array.from({ length: 40 }, (_, i) => i),
      2,
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return true;
      },
      { deadline: Date.now() + 60 },
    );
    const skipped = settled.filter((s) => s.skipped === true).length;
    assert.ok(skipped > 0, "expected some items to be skipped");
    assert.ok(skipped < 40, "expected some items to have run");
  });

  test("handles an empty list", async () => {
    assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  });
});

describe("phaseDeadlines", () => {
  test("splits a budget by share", () => {
    const [a, b, c] = phaseDeadlines(1000, [50, 20, 30], 0);
    assert.equal(a, 500);
    assert.equal(b, 700);
    assert.equal(c, 1000);
  });

  test("the last deadline is always the full budget", () => {
    const d = phaseDeadlines(300, [1, 1, 1], 0);
    assert.equal(d[d.length - 1], 300);
  });
});
