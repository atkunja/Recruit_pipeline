import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { renderResumePdf, wrapText } from "../src/lib/resume/pdf.ts";
import type { ResumeDocument } from "../src/lib/resume/types.ts";

function bullet(text: string, id: number) {
  return { bulletId: id, text, rewritten: false };
}

function buildDocument(entryCount: number, bulletsPerEntry: number): ResumeDocument {
  return {
    header: {
      name: "Ayush Kunjadia",
      email: "ayush@example.com",
      phone: "(555) 555-5555",
      location: "Ann Arbor, MI",
      links: [
        { label: "github.com/example", url: "https://github.com/example" },
        { label: "linkedin.com/in/example", url: "https://linkedin.com/in/example" },
      ],
    },
    education: {
      university: "University of Michigan",
      degree: "B.S.E.",
      major: "Computer Science",
      minor: "Mathematics",
      graduationLabel: "May 2028",
      gpa: "3.85",
    },
    sections: [
      {
        title: "Experience",
        entries: Array.from({ length: entryCount }, (_, entryIndex) => ({
          experienceId: entryIndex + 1,
          organization: `Company ${entryIndex + 1}`,
          title: "Software Engineering Intern",
          location: "San Francisco, CA",
          dateRange: "May 2025 – Aug 2025",
          bullets: Array.from({ length: bulletsPerEntry }, (_, bulletIndex) =>
            bullet(
              "Built a distributed Go service on Kubernetes that reduced p99 latency by 40% across twelve internal endpoints and simplified on-call rotation.",
              entryIndex * 100 + bulletIndex,
            ),
          ),
        })),
      },
    ],
    skills: [
      { label: "Languages", items: ["Go", "TypeScript", "Python", "C++", "SQL"] },
      { label: "Cloud", items: ["AWS", "GCP", "Kubernetes", "Terraform", "Docker"] },
    ],
  };
}

describe("renderResumePdf", () => {
  test("produces a valid single-page PDF", async () => {
    const bytes = await renderResumePdf(buildDocument(3, 4));

    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");

    const parsed = await PDFDocument.load(bytes);
    assert.equal(parsed.getPageCount(), 1);
  });

  test("stays on one page even when the content is dense", async () => {
    // Well past what a real resume holds; the scale ladder should absorb it.
    const bytes = await renderResumePdf(buildDocument(5, 5));
    const parsed = await PDFDocument.load(bytes);
    assert.equal(parsed.getPageCount(), 1);
  });

  test("renders when optional fields are absent", async () => {
    const document = buildDocument(1, 1);
    document.header.phone = null;
    document.header.location = null;
    document.header.links = [];
    document.education.minor = null;
    document.education.gpa = null;
    document.skills = [];

    const bytes = await renderResumePdf(document);
    const parsed = await PDFDocument.load(bytes);
    assert.equal(parsed.getPageCount(), 1);
  });

  test("uses US Letter dimensions", async () => {
    const bytes = await renderResumePdf(buildDocument(2, 3));
    const parsed = await PDFDocument.load(bytes);
    const page = parsed.getPage(0);
    assert.equal(Math.round(page.getWidth()), 612);
    assert.equal(Math.round(page.getHeight()), 792);
  });
});

describe("wrapText", () => {
  test("wraps at the given width", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont("Times-Roman");

    const lines = wrapText(
      "The quick brown fox jumps over the lazy dog again and again and again",
      font,
      10,
      100,
    );
    assert.ok(lines.length > 1);
    for (const line of lines) {
      assert.ok(font.widthOfTextAtSize(line, 10) <= 100, `too wide: ${line}`);
    }
  });

  test("hard-breaks a word longer than the line", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont("Times-Roman");

    const lines = wrapText("a".repeat(200), font, 10, 60);
    assert.ok(lines.length > 1);
    for (const line of lines) {
      assert.ok(font.widthOfTextAtSize(line, 10) <= 60);
    }
  });

  test("returns an empty array for empty input", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont("Times-Roman");
    assert.deepEqual(wrapText("   ", font, 10, 100), []);
  });
});
