import type { ProfileContext } from "../profile/context";
import type { Experience, Skill } from "../types";
import type {
  ResumeDocument,
  ResumeEntry,
  ResumeSection,
  ResumeSkillGroup,
} from "./types";

/**
 * Builds resume documents from verified rows.
 *
 * Both the master resume and every tailored version are assembled here, which
 * is what keeps factual fields (employer, title, dates, GPA) outside the
 * model's reach — a tailoring call supplies ids and bullet wording, and this
 * module fills in everything else from the database.
 */

/** A tailoring decision: which bullets, in what order, worded how. */
export interface EntrySelection {
  experienceId: number;
  bullets: { bulletId: number; text?: string }[];
}

export interface AssembleOptions {
  /** Experience entries in display order. Omit to use every active experience. */
  selections?: EntrySelection[];
  /** Skill names in display order. Omit to use every active skill. */
  skillOrder?: string[];
}

const SECTION_TITLES: Record<string, string> = {
  work: "Experience",
  internship: "Experience",
  startup: "Experience",
  research: "Research",
  project: "Projects",
  leadership: "Leadership",
};

/** Order sections appear on the page. */
const SECTION_ORDER = ["Experience", "Projects", "Research", "Leadership"];

export function assembleResume(
  context: ProfileContext,
  options: AssembleOptions = {},
): ResumeDocument {
  const { profile, experiences, bullets, skills } = context;

  const bulletsById = new Map(bullets.map((bullet) => [bullet.id, bullet]));
  const experiencesById = new Map(experiences.map((exp) => [exp.id, exp]));

  const selections: EntrySelection[] =
    options.selections ??
    experiences.map((experience) => ({
      experienceId: experience.id,
      bullets: bullets
        .filter((bullet) => bullet.experienceId === experience.id)
        .map((bullet) => ({ bulletId: bullet.id })),
    }));

  const sections = new Map<string, ResumeEntry[]>();

  for (const selection of selections) {
    const experience = experiencesById.get(selection.experienceId);
    // Silently skipping is right here: an unknown id is caught by the
    // integrity checker with a real message, not hidden behind a throw.
    if (!experience) continue;

    const lines = selection.bullets.flatMap((choice) => {
      const bullet = bulletsById.get(choice.bulletId);
      if (!bullet) return [];
      if (bullet.experienceId !== experience.id) return [];

      const text = (choice.text ?? bullet.canonicalText).trim();
      return [
        {
          bulletId: bullet.id,
          text,
          rewritten: text !== bullet.canonicalText,
        },
      ];
    });

    // An experience with no bullets left is not worth a heading.
    if (lines.length === 0) continue;

    const entry: ResumeEntry = {
      experienceId: experience.id,
      organization: experience.organization,
      title: experience.title,
      location: experience.location,
      dateRange: formatRange(experience),
      bullets: lines,
    };

    const sectionTitle = SECTION_TITLES[experience.kind] ?? "Experience";
    const existing = sections.get(sectionTitle) ?? [];
    existing.push(entry);
    sections.set(sectionTitle, existing);
  }

  const orderedSections: ResumeSection[] = SECTION_ORDER.filter((title) =>
    sections.has(title),
  ).map((title) => ({ title, entries: sections.get(title) ?? [] }));

  return {
    header: {
      name: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      links: buildLinks(profile.githubUrl, profile.linkedinUrl, profile.portfolioUrl),
    },
    education: {
      university: profile.university,
      degree: profile.degree,
      major: profile.major,
      minor: profile.minor,
      graduationLabel: formatMonthYear(profile.graduationDate),
      gpa: profile.gpa,
    },
    sections: orderedSections,
    skills: buildSkillGroups(skills, options.skillOrder),
  };
}

function buildLinks(
  github: string | null,
  linkedin: string | null,
  portfolio: string | null,
) {
  const links: { label: string; url: string }[] = [];
  if (github) links.push({ label: stripProtocol(github), url: github });
  if (linkedin) links.push({ label: stripProtocol(linkedin), url: linkedin });
  if (portfolio) links.push({ label: stripProtocol(portfolio), url: portfolio });
  return links;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

const SKILL_GROUP_LABELS: Record<string, string> = {
  language: "Languages",
  framework: "Frameworks",
  library: "Libraries",
  tool: "Tools",
  cloud: "Cloud",
  database: "Databases",
  domain: "Domains",
};

/**
 * Group skills by category, honouring a caller-supplied ordering.
 * `skillOrder` only reorders; a name not in the list still appears, and a name
 * not in the verified list is dropped rather than trusted.
 */
function buildSkillGroups(
  skills: Skill[],
  skillOrder?: string[],
): ResumeSkillGroup[] {
  const ranking = new Map<string, number>();
  skillOrder?.forEach((name, index) => ranking.set(name.toLowerCase(), index));

  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    const list = groups.get(skill.category) ?? [];
    list.push(skill);
    groups.set(skill.category, list);
  }

  const result: ResumeSkillGroup[] = [];
  for (const [category, list] of groups) {
    const sorted = [...list].sort((a, b) => {
      const rankA = ranking.get(a.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const rankB = ranking.get(b.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return b.proficiency - a.proficiency;
    });
    result.push({
      label: SKILL_GROUP_LABELS[category] ?? category,
      items: sorted.map((skill) => skill.name),
    });
  }

  // Groups containing a highly-ranked skill float to the top.
  return result.sort((a, b) => bestRank(a, ranking) - bestRank(b, ranking));
}

function bestRank(
  group: ResumeSkillGroup,
  ranking: Map<string, number>,
): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const item of group.items) {
    best = Math.min(best, ranking.get(item.toLowerCase()) ?? Number.MAX_SAFE_INTEGER);
  }
  return best;
}

function formatRange(experience: Experience): string {
  const start = formatMonthYear(experience.startDate);
  const end = experience.isCurrent
    ? "Present"
    : experience.endDate
      ? formatMonthYear(experience.endDate)
      : "Present";
  return `${start} – ${end}`;
}

export function formatMonthYear(date: Date | string): string {
  const value = date instanceof Date ? date : new Date(date);
  return value.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
