import "server-only";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { ResumeDocument } from "./types";

/**
 * One-page PDF renderer.
 *
 * Uses pdf-lib with the built-in Times family: no headless browser, no font
 * files, no storage bucket. The layout is a conventional single-column resume
 * because that is what ATS parsers read reliably.
 *
 * Fitting to one page is handled by measuring first: if the content overflows,
 * the whole document is re-laid out a step smaller (font size, then leading,
 * then margins) until it fits or we run out of steps.
 */

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;

interface LayoutScale {
  bodySize: number;
  nameSize: number;
  headingSize: number;
  lineGap: number;
  entryGap: number;
  sectionGap: number;
  margin: number;
}

/** Progressively tighter layouts, tried in order until the content fits. */
const SCALES: LayoutScale[] = [
  { bodySize: 10.0, nameSize: 20, headingSize: 10.5, lineGap: 2.6, entryGap: 6.5, sectionGap: 9, margin: 54 },
  { bodySize: 9.6,  nameSize: 19, headingSize: 10.0, lineGap: 2.2, entryGap: 5.5, sectionGap: 8, margin: 50 },
  { bodySize: 9.2,  nameSize: 18, headingSize: 9.6,  lineGap: 1.9, entryGap: 4.8, sectionGap: 7, margin: 46 },
  { bodySize: 8.8,  nameSize: 17, headingSize: 9.2,  lineGap: 1.6, entryGap: 4.0, sectionGap: 6, margin: 42 },
  { bodySize: 8.4,  nameSize: 16, headingSize: 8.8,  lineGap: 1.3, entryGap: 3.4, sectionGap: 5, margin: 38 },
];

const INK = rgb(0.06, 0.06, 0.08);
const RULE = rgb(0.45, 0.45, 0.5);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

export async function renderResumePdf(
  document: ResumeDocument,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${document.header.name} — Resume`);
  pdf.setAuthor(document.header.name);
  pdf.setCreator("Recruiting Pipeline");

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
  };

  // Measure each scale with a dry run; draw with the first that fits.
  let chosen = SCALES[SCALES.length - 1] as LayoutScale;
  for (const scale of SCALES) {
    const height = layout(document, fonts, scale, null);
    if (height <= PAGE_HEIGHT - scale.margin) {
      chosen = scale;
      break;
    }
  }

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  layout(document, fonts, chosen, page);

  return pdf.save();
}

/**
 * Lay the document out, drawing onto `page` when given and only measuring when
 * it is null. Returns the total height consumed, measured from the top margin.
 */
function layout(
  document: ResumeDocument,
  fonts: Fonts,
  scale: LayoutScale,
  page: PDFPage | null,
): number {
  const contentWidth = PAGE_WIDTH - scale.margin * 2;
  let y = PAGE_HEIGHT - scale.margin;

  const draw = (
    text: string,
    x: number,
    baselineY: number,
    font: PDFFont,
    size: number,
  ) => {
    page?.drawText(text, { x, y: baselineY, font, size, color: INK });
  };

  // --- header --------------------------------------------------------------
  const name = document.header.name;
  const nameWidth = fonts.bold.widthOfTextAtSize(name, scale.nameSize);
  y -= scale.nameSize;
  draw(name, (PAGE_WIDTH - nameWidth) / 2, y, fonts.bold, scale.nameSize);

  const contactParts = [
    document.header.location,
    document.header.phone,
    document.header.email,
    ...document.header.links.map((link) => link.label),
  ].filter((part): part is string => part !== null && part.length > 0);

  if (contactParts.length > 0) {
    const contact = contactParts.join("  •  ");
    y -= scale.bodySize + scale.lineGap + 2;
    const width = fonts.regular.widthOfTextAtSize(contact, scale.bodySize);
    // Long contact lines get split rather than overflowing the page.
    if (width <= contentWidth) {
      draw(contact, (PAGE_WIDTH - width) / 2, y, fonts.regular, scale.bodySize);
    } else {
      const half = Math.ceil(contactParts.length / 2);
      const rows = [
        contactParts.slice(0, half).join("  •  "),
        contactParts.slice(half).join("  •  "),
      ];
      for (const [index, row] of rows.entries()) {
        const rowWidth = fonts.regular.widthOfTextAtSize(row, scale.bodySize);
        const rowY = y - index * (scale.bodySize + scale.lineGap);
        draw(row, (PAGE_WIDTH - rowWidth) / 2, rowY, fonts.regular, scale.bodySize);
      }
      y -= scale.bodySize + scale.lineGap;
    }
  }

  y -= scale.sectionGap;

  // --- education -----------------------------------------------------------
  y = drawSectionHeading("Education", y);

  const education = document.education;
  const degreeLine = `${education.degree}, ${education.major}${
    education.minor ? ` (Minor: ${education.minor})` : ""
  }${education.gpa ? ` — GPA ${education.gpa}` : ""}`;

  y -= scale.bodySize;
  draw(education.university, scale.margin, y, fonts.bold, scale.bodySize);
  const gradWidth = fonts.regular.widthOfTextAtSize(
    education.graduationLabel,
    scale.bodySize,
  );
  draw(
    education.graduationLabel,
    PAGE_WIDTH - scale.margin - gradWidth,
    y,
    fonts.regular,
    scale.bodySize,
  );

  y -= scale.bodySize + scale.lineGap;
  draw(degreeLine, scale.margin, y, fonts.italic, scale.bodySize);
  y -= scale.sectionGap;

  // --- experience sections -------------------------------------------------
  for (const section of document.sections) {
    y = drawSectionHeading(section.title, y);

    for (const entry of section.entries) {
      y -= scale.bodySize;
      draw(entry.organization, scale.margin, y, fonts.bold, scale.bodySize);

      const dateWidth = fonts.regular.widthOfTextAtSize(
        entry.dateRange,
        scale.bodySize,
      );
      draw(
        entry.dateRange,
        PAGE_WIDTH - scale.margin - dateWidth,
        y,
        fonts.regular,
        scale.bodySize,
      );

      y -= scale.bodySize + scale.lineGap;
      draw(entry.title, scale.margin, y, fonts.italic, scale.bodySize);
      if (entry.location) {
        const locationWidth = fonts.italic.widthOfTextAtSize(
          entry.location,
          scale.bodySize,
        );
        draw(
          entry.location,
          PAGE_WIDTH - scale.margin - locationWidth,
          y,
          fonts.italic,
          scale.bodySize,
        );
      }

      const bulletIndent = scale.margin + 10;
      const bulletWidth = contentWidth - 10;

      for (const line of entry.bullets) {
        const wrapped = wrapText(
          line.text,
          fonts.regular,
          scale.bodySize,
          bulletWidth,
        );
        for (const [index, row] of wrapped.entries()) {
          y -= scale.bodySize + scale.lineGap;
          if (index === 0) {
            draw("•", scale.margin + 2, y, fonts.regular, scale.bodySize);
          }
          draw(row, bulletIndent, y, fonts.regular, scale.bodySize);
        }
      }

      y -= scale.entryGap;
    }
    y -= scale.sectionGap - scale.entryGap;
  }

  // --- skills --------------------------------------------------------------
  if (document.skills.length > 0) {
    y = drawSectionHeading("Skills", y);

    for (const group of document.skills) {
      if (group.items.length === 0) continue;
      const label = `${group.label}: `;
      const labelWidth = fonts.bold.widthOfTextAtSize(label, scale.bodySize);
      const wrapped = wrapText(
        group.items.join(", "),
        fonts.regular,
        scale.bodySize,
        contentWidth - labelWidth,
      );

      for (const [index, row] of wrapped.entries()) {
        y -= scale.bodySize + scale.lineGap;
        if (index === 0) {
          draw(label, scale.margin, y, fonts.bold, scale.bodySize);
          draw(row, scale.margin + labelWidth, y, fonts.regular, scale.bodySize);
        } else {
          draw(row, scale.margin + labelWidth, y, fonts.regular, scale.bodySize);
        }
      }
    }
  }

  return PAGE_HEIGHT - y;

  function drawSectionHeading(title: string, currentY: number): number {
    let next = currentY - scale.headingSize;
    draw(
      title.toUpperCase(),
      scale.margin,
      next,
      fonts.bold,
      scale.headingSize,
    );
    next -= 3;
    page?.drawLine({
      start: { x: scale.margin, y: next },
      end: { x: PAGE_WIDTH - scale.margin, y: next },
      thickness: 0.6,
      color: RULE,
    });
    return next - 2;
  }
}

/**
 * Greedy word wrap against real glyph widths.
 * A word longer than the line (a very long URL) is hard-broken rather than
 * allowed to run off the page.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
      current = "";
    }

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    current = chunk;
  }

  if (current.length > 0) lines.push(current);
  return lines;
}
