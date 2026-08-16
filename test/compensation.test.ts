import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatCompensation,
  monthlyMidpoint,
  parseCompensation,
} from "../src/lib/jobs/compensation.ts";

/** Every string below is real wording taken from postings in the database. */

describe("parseCompensation — real postings", () => {
  test("hourly range", () => {
    const c = parseCompensation("The pay range for this internship is $45.00 - $65.00 per hour.");
    assert.equal(c?.min, 45);
    assert.equal(c?.max, 65);
    assert.equal(c?.period, "hour");
    assert.equal(c?.periodStated, true);
  });

  test("monthly, slash form", () => {
    const c = parseCompensation("The salary range for this position is estimated to be $10,000/month");
    assert.equal(c?.min, 10_000);
    assert.equal(c?.period, "month");
    assert.equal(c?.monthlyMin, 10_000);
  });

  test("weekly", () => {
    const c = parseCompensation("Trading Interns at Susquehanna will receive a $7,600 weekly base");
    assert.equal(c?.min, 7_600);
    assert.equal(c?.period, "week");
    // 7600 * 52 / 12
    assert.equal(c?.monthlyMin, 32_933);
  });

  test("annual, single figure", () => {
    const c = parseCompensation("The estimated base salary for this role is $300,000 per year");
    assert.equal(c?.min, 300_000);
    assert.equal(c?.period, "year");
    assert.equal(c?.monthlyMin, 25_000);
  });

  test("em-dash range with a trailing currency", () => {
    const c = parseCompensation("Base Salary Range $70,000 — $88,000 USD");
    assert.equal(c?.min, 70_000);
    assert.equal(c?.max, 88_000);
    assert.equal(c?.period, "year", "six figures with no unit should read as annual");
  });

  test("colon form with no period stated", () => {
    const c = parseCompensation("Base Salary: $250,000 About Us IMC is a global trading firm");
    assert.equal(c?.min, 250_000);
    assert.equal(c?.period, "year");
    assert.equal(c?.periodStated, false);
  });
});

describe("parseCompensation — rejects things that are not pay", () => {
  test("assets under management", () => {
    assert.equal(
      parseCompensation("Walleye Capital is a ~$17 billion+ multi-strategy investment firm"),
      null,
    );
  });

  test("funding and valuation", () => {
    assert.equal(parseCompensation("We raised a $50 million Series B last year."), null);
    assert.equal(parseCompensation("a company with $2 billion in annual revenue"), null);
  });

  test("no money at all", () => {
    assert.equal(parseCompensation("Join our backend team for the summer."), null);
    assert.equal(parseCompensation(null), null);
    assert.equal(parseCompensation(""), null);
  });

  test("trivial amounts", () => {
    assert.equal(parseCompensation("Coffee is $3 in the cafeteria."), null);
  });
});

describe("parseCompensation — picks the right figure", () => {
  test("prefers the salary over a smaller stipend mentioned first", () => {
    const c = parseCompensation(
      "We offer a $2,000 relocation stipend. The base pay range is $50.00 - $70.00 per hour.",
    );
    assert.equal(c?.period, "hour");
    assert.equal(c?.min, 50);
  });

  test("prefers an explicitly-periodised figure over a bare number", () => {
    const c = parseCompensation(
      "Signing bonus up to $15,000. Interns are paid $55 per hour.",
    );
    assert.equal(c?.periodStated, true);
    assert.equal(c?.period, "hour");
  });
});

describe("normalisation makes units comparable", () => {
  test("hourly, monthly and annual land on the same scale", () => {
    const hourly = parseCompensation("$60.00 per hour");
    const monthly = parseCompensation("$10,000 per month");
    const yearly = parseCompensation("$120,000 per year");

    // $60/hr ≈ $10.4k/mo, $120k/yr = $10k/mo — all within a sensible band.
    for (const c of [hourly, monthly, yearly]) {
      assert.ok(c !== null);
      assert.ok(
        monthlyMidpoint(c) > 9_000 && monthlyMidpoint(c) < 12_000,
        `${c.raw} normalised to ${monthlyMidpoint(c)}`,
      );
    }
  });

  test("a weekly trading-firm figure outranks a typical hourly one", () => {
    const sig = parseCompensation("$7,600 weekly base");
    const typical = parseCompensation("$50.00 per hour");
    assert.ok(monthlyMidpoint(sig!) > monthlyMidpoint(typical!));
  });
});

describe("formatCompensation", () => {
  test("renders each period compactly", () => {
    assert.equal(formatCompensation(parseCompensation("$45 - $65 per hour")!), "$45–65/hr");
    assert.equal(formatCompensation(parseCompensation("$10,000 per month")!), "$10,000/mo");
    assert.equal(formatCompensation(parseCompensation("$300,000 per year")!), "$300,000/yr");
    assert.equal(formatCompensation(parseCompensation("$7,600 weekly")!), "$7,600/wk");
  });

  test("keeps cents on hourly rates that have them", () => {
    assert.equal(formatCompensation(parseCompensation("$45.50 per hour")!), "$45.50/hr");
  });
});
