import "server-only";
import { sql } from "../db";
import type { Experience, Profile, ResumeBullet, Skill } from "../types";

/**
 * Assembles the verified candidate record that every AI feature reads from.
 *
 * This is the *only* source of biographical fact in the system. Prompts are
 * built from this object and instructed to use nothing else, which is what
 * makes "the AI may not invent anything" enforceable rather than aspirational.
 */

export interface ProfileContext {
  profile: Profile;
  experiences: Experience[];
  bullets: ResumeBullet[];
  skills: Skill[];
}

export async function loadProfileContext(): Promise<ProfileContext> {
  const [profiles, experiences, bullets, skills] = await Promise.all([
    sql<Profile[]>`select * from profile where id = 1`,
    sql<Experience[]>`
      select * from experiences
      where is_active and verified
      order by display_order asc, start_date desc
    `,
    sql<ResumeBullet[]>`
      select * from resume_bullets
      where is_active and verified
      order by experience_id asc, display_order asc, strength desc
    `,
    sql<Skill[]>`
      select * from skills
      where is_active
      order by category asc, display_order asc, proficiency desc
    `,
  ]);

  const profile = profiles[0];
  if (!profile) {
    throw new Error(
      "No profile row found. Run `npm run db:seed` or fill in Settings → Profile.",
    );
  }

  return { profile, experiences, bullets, skills };
}

/** Every technology and skill the candidate has verified, lowercased. */
export function verifiedTechnologies(context: ProfileContext): Set<string> {
  const set = new Set<string>();
  for (const skill of context.skills) set.add(skill.name.toLowerCase());
  for (const experience of context.experiences) {
    for (const tech of experience.technologies) set.add(tech.toLowerCase());
  }
  for (const bullet of context.bullets) {
    for (const tech of bullet.technologies) set.add(tech.toLowerCase());
    for (const skill of bullet.skills) set.add(skill.toLowerCase());
  }
  return set;
}

/**
 * Render the profile as compact text for a prompt.
 *
 * Deliberately terse: this text is prepended to every scoring call, so each
 * wasted line is paid for on every job in every discovery run.
 */
export function renderProfileForPrompt(context: ProfileContext): string {
  const { profile, experiences, bullets, skills } = context;

  const lines: string[] = [];

  lines.push(`CANDIDATE: ${profile.fullName}`);
  lines.push(
    `EDUCATION: ${profile.degree} in ${profile.major}${
      profile.minor ? ` (minor: ${profile.minor})` : ""
    }, ${profile.university}. Graduates ${formatDate(profile.graduationDate)}.${
      profile.gpa ? ` GPA ${profile.gpa}.` : ""
    }`,
  );
  lines.push(
    `WORK AUTHORIZATION: ${profile.workAuthorization}. Needs sponsorship: ${
      profile.needsSponsorship ? "yes" : "no"
    }.`,
  );
  lines.push(`TARGET: ${profile.targetSeason} internships.`);
  if (profile.preferredLocations.length > 0) {
    lines.push(`PREFERRED LOCATIONS: ${profile.preferredLocations.join(", ")}.`);
  }
  if (profile.targetCategories.length > 0) {
    lines.push(`TARGET ROLE CATEGORIES: ${profile.targetCategories.join(", ")}.`);
  }
  if (profile.summary) lines.push(`SUMMARY: ${profile.summary}`);

  if (skills.length > 0) {
    const byCategory = new Map<string, string[]>();
    for (const skill of skills) {
      const list = byCategory.get(skill.category) ?? [];
      list.push(skill.name);
      byCategory.set(skill.category, list);
    }
    lines.push("\nSKILLS:");
    for (const [category, names] of byCategory) {
      lines.push(`  ${category}: ${names.join(", ")}`);
    }
  }

  const bulletsByExperience = new Map<number, ResumeBullet[]>();
  for (const bullet of bullets) {
    const list = bulletsByExperience.get(bullet.experienceId) ?? [];
    list.push(bullet);
    bulletsByExperience.set(bullet.experienceId, list);
  }

  lines.push("\nEXPERIENCE:");
  for (const experience of experiences) {
    const period = `${formatDate(experience.startDate)} – ${
      experience.isCurrent ? "present" : formatDate(experience.endDate)
    }`;
    lines.push(
      `[exp:${experience.id}] ${experience.title} @ ${experience.organization} (${experience.kind}, ${period})`,
    );
    if (experience.technologies.length > 0) {
      lines.push(`  tech: ${experience.technologies.join(", ")}`);
    }
    for (const bullet of bulletsByExperience.get(experience.id) ?? []) {
      lines.push(`  [b:${bullet.id}] ${bullet.canonicalText}`);
    }
  }

  return lines.join("\n");
}

function formatDate(date: Date | null): string {
  if (date === null) return "present";
  const value = date instanceof Date ? date : new Date(date);
  return value.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
