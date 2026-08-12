import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyQuestion,
  isSensitiveQuestion,
} from "../src/lib/apply/answers.ts";
import { detectAts, FIELD_MAPS, PLATFORM_SUPPORT } from "../src/lib/apply/ats.ts";
import { buildMime } from "../src/lib/gmail/send.ts";
import { extractEmail, extractName } from "../src/lib/gmail/sync.ts";

describe("isSensitiveQuestion", () => {
  test("flags self-identification questions", () => {
    for (const question of [
      "What is your race/ethnicity?",
      "Please select your gender",
      "Do you have a disability?",
      "Are you a protected veteran?",
      "Voluntary Self-Identification of Disability",
      "What is your sexual orientation?",
      "Please provide your date of birth",
    ]) {
      assert.equal(isSensitiveQuestion(question), true, question);
    }
  });

  test("flags compensation and criminal-history questions", () => {
    assert.equal(isSensitiveQuestion("What is your desired salary?"), true);
    assert.equal(isSensitiveQuestion("Salary expectations?"), true);
    assert.equal(
      isSensitiveQuestion("Have you ever been convicted of a felony?"),
      true,
    );
  });

  test("does not flag ordinary application questions", () => {
    for (const question of [
      "Why are you interested in this company?",
      "Describe a technical project you are proud of.",
      "What programming languages do you know?",
      "When can you start?",
      "Are you legally authorized to work in the United States?",
    ]) {
      assert.equal(isSensitiveQuestion(question), false, question);
    }
  });
});

describe("classifyQuestion", () => {
  test("sensitive wins over every other category", () => {
    assert.equal(classifyQuestion("What is your gender?"), "sensitive");
    // Mentions salary, which is sensitive, even though it reads like logistics.
    assert.equal(classifyQuestion("What is your desired salary?"), "sensitive");
  });

  test("recognises the standard categories", () => {
    assert.equal(classifyQuestion("Why are you interested in this company?"), "why_company");
    assert.equal(classifyQuestion("Why this role?"), "why_role");
    assert.equal(
      classifyQuestion("Describe a project where you solved a hard problem"),
      "experience",
    );
    assert.equal(
      classifyQuestion("What technologies have you worked with?"),
      "technical",
    );
    assert.equal(classifyQuestion("When are you available to start?"), "logistics");
  });
});

describe("detectAts", () => {
  test("recognises each supported platform", () => {
    assert.equal(detectAts("https://boards.greenhouse.io/acme/jobs/123"), "greenhouse");
    assert.equal(detectAts("https://job-boards.greenhouse.io/acme/jobs/123"), "greenhouse");
    assert.equal(detectAts("https://jobs.lever.co/acme/uuid-here"), "lever");
    assert.equal(detectAts("https://jobs.ashbyhq.com/acme/uuid"), "ashby");
    assert.equal(detectAts("https://acme.wd1.myworkdayjobs.com/careers/job"), "workday");
  });

  test("recognises a Greenhouse-embedded careers page by its query param", () => {
    assert.equal(
      detectAts("https://www.acme.com/careers/apply?gh_jid=5735295004"),
      "greenhouse",
    );
  });

  test("returns unknown for anything else", () => {
    assert.equal(detectAts("https://acme.com/careers/swe-intern"), "unknown");
    assert.equal(detectAts("not a url"), "unknown");
  });
});

describe("field maps", () => {
  test("every supported platform has a resume upload target", () => {
    for (const platform of ["greenhouse", "lever", "ashby", "workday"] as const) {
      const fields = FIELD_MAPS[platform];
      assert.ok(
        fields.some((field) => field.file === true),
        `${platform} has no file field`,
      );
    }
  });

  test("every field offers at least one selector", () => {
    for (const [platform, fields] of Object.entries(FIELD_MAPS)) {
      for (const field of fields) {
        assert.ok(
          field.selectors.length > 0,
          `${platform}.${field.field} has no selectors`,
        );
      }
    }
  });

  test("unknown platforms are declared unsupported rather than half-filled", () => {
    assert.equal(FIELD_MAPS.unknown.length, 0);
    assert.equal(PLATFORM_SUPPORT.unknown.level, "none");
  });
});

describe("buildMime", () => {
  test("builds a well-formed message", () => {
    const mime = buildMime({
      to: "recruiter@example.com",
      subject: "Quick question about the SWE intern role",
      body: "Hi there,\n\nShort message.\n\nAyush",
    });

    assert.match(mime, /^To: recruiter@example\.com\r\n/);
    assert.match(mime, /Subject: Quick question about the SWE intern role\r\n/);
    // Headers and body separated by a blank line.
    assert.ok(mime.includes("\r\n\r\n"));
    // Bare newlines in the body normalised to CRLF.
    assert.ok(!/[^\r]\n/.test(mime));
  });

  test("refuses a recipient carrying an injected header", () => {
    assert.throws(
      () =>
        buildMime({
          to: "recruiter@example.com\r\nBcc: attacker@evil.com",
          subject: "Hello",
          body: "text",
        }),
      /line break/i,
    );
  });

  test("refuses an address that isn't one", () => {
    assert.throws(
      () => buildMime({ to: "not-an-address", subject: "Hi", body: "text" }),
      /not a valid email address/i,
    );
  });

  test("flattens a newline in the subject instead of creating a header", () => {
    const mime = buildMime({
      to: "recruiter@example.com",
      subject: "Hello\r\nX-Injected: yes",
      body: "text",
    });

    // The text may survive, but never at the start of its own header line.
    assert.ok(
      !/\r\nX-Injected:/.test(mime),
      "subject injection created a real header",
    );
  });

  test("encodes a non-ASCII subject", () => {
    const mime = buildMime({
      to: "a@b.com",
      subject: "Café résumé",
      body: "text",
    });
    assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  });

  test("adds threading headers for a reply", () => {
    const mime = buildMime({
      to: "a@b.com",
      subject: "Re: hello",
      body: "text",
      inReplyTo: "<abc@mail.gmail.com>",
    });
    assert.match(mime, /In-Reply-To: <abc@mail\.gmail\.com>/);
    assert.match(mime, /References: <abc@mail\.gmail\.com>/);
  });
});

describe("email header parsing", () => {
  test("pulls the address out of a From header", () => {
    assert.equal(
      extractEmail('"Jane Doe" <jane.doe@acme.com>'),
      "jane.doe@acme.com",
    );
    assert.equal(extractEmail("jane@acme.com"), "jane@acme.com");
    assert.equal(extractEmail("Jane Doe <JANE@ACME.COM>"), "jane@acme.com");
  });

  test("pulls the display name out", () => {
    assert.equal(extractName('"Jane Doe" <jane@acme.com>'), "Jane Doe");
    assert.equal(extractName("Jane Doe <jane@acme.com>"), "Jane Doe");
    assert.equal(extractName("jane@acme.com"), "");
  });
});
