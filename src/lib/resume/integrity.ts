import type { Experience, ResumeBullet, Skill } from "../types";
import type { ResumeDocument, IntegrityReport } from "./types";

/**
 * The anti-fabrication check.
 *
 * The prompt tells the model not to invent anything. This function is what
 * makes that a guarantee rather than a hope: a generated resume is compared
 * against the verified bullet bank and rejected if it introduces a number, a
 * technology, or an id that does not appear in the source.
 *
 * Pure and dependency-free so it can be unit tested exhaustively — which
 * matters, because it is the last line of defence on the one thing the user
 * asked to never get wrong.
 */

export interface IntegrityInput {
  document: ResumeDocument;
  bullets: ResumeBullet[];
  experiences: Experience[];
  skills: Skill[];
}

/** Words that look like technologies but are ordinary English. */
const COMMON_WORDS = new Set([
  "a", "an", "and", "the", "for", "with", "to", "of", "in", "on", "by", "at",
  "from", "into", "over", "under", "using", "used", "use", "via", "across",
  "built", "build", "building", "designed", "design", "developed", "develop",
  "implemented", "implement", "created", "create", "led", "lead", "wrote",
  "write", "reduced", "reduce", "improved", "improve", "increased", "increase",
  "optimized", "optimize", "shipped", "ship", "added", "add", "migrated",
  "migrate", "automated", "automate", "refactored", "refactor", "deployed",
  "deploy", "engineered", "architected", "owned", "own", "drove", "scaled",
  "team", "teams", "service", "services", "system", "systems", "data", "code",
  "test", "tests", "testing", "api", "apis", "pipeline", "pipelines", "user",
  "users", "time", "times", "new", "per", "that", "which", "while", "based",
  "including", "such", "as", "is", "was", "were", "are", "be", "been", "it",
  "its", "our", "their", "his", "her", "them", "this", "these", "those",
  "latency", "throughput", "performance", "reliability", "scale", "support",
  "production", "internal", "external", "end", "front", "back", "full", "stack",
]);

export function checkIntegrity(input: IntegrityInput): IntegrityReport {
  const issues: string[] = [];

  const bulletsById = new Map(input.bullets.map((b) => [b.id, b]));
  const experiencesById = new Map(input.experiences.map((e) => [e.id, e]));

  // Everything the candidate has actually verified, lowercased.
  const allowedTerms = new Set<string>();
  for (const skill of input.skills) allowedTerms.add(skill.name.toLowerCase());
  for (const experience of input.experiences) {
    for (const tech of experience.technologies) allowedTerms.add(tech.toLowerCase());
    allowedTerms.add(experience.organization.toLowerCase());
  }
  for (const bullet of input.bullets) {
    for (const tech of bullet.technologies) allowedTerms.add(tech.toLowerCase());
    for (const skill of bullet.skills) allowedTerms.add(skill.toLowerCase());
  }

  const seenBulletIds = new Set<number>();

  for (const section of input.document.sections) {
    for (const entry of section.entries) {
      const experience = experiencesById.get(entry.experienceId);
      if (!experience) {
        issues.push(
          `Entry references experience ${entry.experienceId}, which is not a verified experience.`,
        );
        continue;
      }

      // Factual fields are copied from the database at assembly time; if they
      // ever diverge, something wrote to the document that should not have.
      if (entry.organization !== experience.organization) {
        issues.push(
          `Organization "${entry.organization}" does not match verified "${experience.organization}".`,
        );
      }
      if (entry.title !== experience.title) {
        issues.push(
          `Title "${entry.title}" does not match verified "${experience.title}".`,
        );
      }

      for (const line of entry.bullets) {
        const bullet = bulletsById.get(line.bulletId);
        if (!bullet) {
          issues.push(
            `Bullet ${line.bulletId} is not in the verified bullet bank.`,
          );
          continue;
        }
        if (bullet.experienceId !== entry.experienceId) {
          issues.push(
            `Bullet ${line.bulletId} belongs to experience ${bullet.experienceId} but was placed under ${entry.experienceId}.`,
          );
        }
        if (seenBulletIds.has(line.bulletId)) {
          issues.push(`Bullet ${line.bulletId} appears more than once.`);
        }
        seenBulletIds.add(line.bulletId);

        issues.push(...checkLine(line.text, bullet, allowedTerms));
      }
    }
  }

  // Skills must all be verified skill names.
  const skillNames = new Set(input.skills.map((s) => s.name.toLowerCase()));
  for (const group of input.document.skills) {
    for (const item of group.items) {
      if (!skillNames.has(item.toLowerCase())) {
        issues.push(`Skill "${item}" is not in the verified skill list.`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Check one rewritten bullet against its canonical source. */
function checkLine(
  text: string,
  bullet: ResumeBullet,
  allowedTerms: Set<string>,
): string[] {
  const issues: string[] = [];
  const canonical = bullet.canonicalText;

  // --- numbers -------------------------------------------------------------
  // Every quantitative claim in the rewrite must exist in the canonical text
  // (or in the extracted metrics), because a fabricated metric is the single
  // most damaging thing this system could produce.
  const canonicalNumbers = new Set(extractNumbers(canonical));
  for (const metric of bullet.metrics) {
    for (const value of extractNumbers(metric)) canonicalNumbers.add(value);
  }

  for (const value of extractNumbers(text)) {
    if (!canonicalNumbers.has(value)) {
      issues.push(
        `Bullet ${bullet.id} states "${value}", which does not appear in the verified text: "${truncate(canonical)}"`,
      );
    }
  }

  // --- technologies --------------------------------------------------------
  const canonicalTerms = new Set(
    tokenize(canonical).map((token) => token.toLowerCase()),
  );
  for (const candidate of technologyLikeTokens(text)) {
    const lower = candidate.toLowerCase();
    if (canonicalTerms.has(lower)) continue;
    if (allowedTerms.has(lower)) continue;
    issues.push(
      `Bullet ${bullet.id} mentions "${candidate}", which is not in the verified text or skill list.`,
    );
  }

  // --- length --------------------------------------------------------------
  // Rewrites are allowed to shorten and rephrase, not to expand into new
  // claims. A rewrite substantially longer than its source is suspicious.
  if (text.length > canonical.length * 1.6 + 30) {
    issues.push(
      `Bullet ${bullet.id} grew from ${canonical.length} to ${text.length} characters, which suggests added content.`,
    );
  }

  return issues;
}

/**
 * Numeric claims in a string, normalized so "40%" and "40 %" compare equal.
 * Years like "2027" are ignored — they are dates, not accomplishments.
 */
export function extractNumbers(text: string): string[] {
  const matches = text.matchAll(
    /(\$?\d[\d,]*\.?\d*)\s*(%|percent|x|ms|s\b|k\b|m\b|b\b|gb|tb|mb|qps|rps|req\/s)?/gi,
  );

  const values: string[] = [];
  for (const match of matches) {
    const rawNumber = match[1];
    if (rawNumber === undefined) continue;

    const digits = rawNumber.replace(/[$,]/g, "");
    // Skip four-digit years.
    if (/^(19|20)\d\d$/.test(digits)) continue;
    if (digits.length === 0) continue;

    const unit = (match[2] ?? "").toLowerCase().replace(/percent/, "%");
    values.push(`${Number(digits)}${unit}`);
  }
  return values;
}

/**
 * Tokens that look like technology names: capitalised mid-sentence, or
 * containing punctuation typical of tools (C++, Node.js, gRPC).
 */
export function technologyLikeTokens(text: string): string[] {
  const tokens = tokenize(text);
  const results: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (COMMON_WORDS.has(token.toLowerCase())) continue;
    if (token.length < 2) continue;

    const isFirstWord = index === 0;
    const hasInternalCaps = /[a-z][A-Z]/.test(token);
    const hasTechPunctuation = /[+#.]/.test(token) && /[a-zA-Z]/.test(token);
    const isCapitalised = /^[A-Z]/.test(token);
    const isAcronym = /^[A-Z]{2,}$/.test(token);

    if (hasInternalCaps || hasTechPunctuation || isAcronym) {
      results.push(token);
    } else if (isCapitalised && !isFirstWord) {
      results.push(token);
    }
  }
  return results;
}

function tokenize(text: string): string[] {
  return text
    .split(/[\s,;:()[\]"']+/)
    .map((token) => token.replace(/[.,;:!?]+$/, ""))
    .filter((token) => token.length > 0);
}

function truncate(text: string, max = 90): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
