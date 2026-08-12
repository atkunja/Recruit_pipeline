/**
 * Profile seeder: `npm run db:seed`
 *
 * Loads `db/profile.json` (or the example, with a warning) and writes the
 * profile, skills, experiences and bullet bank. Re-running replaces the
 * profile in place; experiences are matched on organization+title so editing
 * the file and re-seeding updates rather than duplicates.
 *
 * Self-contained so Node can run it directly.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

interface BulletSeed {
  canonicalText: string;
  skills?: string[];
  technologies?: string[];
  metrics?: string[];
  keywords?: string[];
  categories?: string[];
  strength?: number;
}

interface ExperienceSeed {
  kind: string;
  organization: string;
  title: string;
  location?: string | null;
  startDate: string;
  endDate?: string | null;
  isCurrent?: boolean;
  description?: string | null;
  technologies?: string[];
  categories?: string[];
  url?: string | null;
  displayOrder?: number;
  bullets?: BulletSeed[];
}

interface SkillSeed {
  name: string;
  category: string;
  proficiency?: number;
  years?: number | null;
}

interface ProfileSeed {
  profile: Record<string, unknown>;
  skills?: SkillSeed[];
  experiences?: ExperienceSeed[];
}

async function loadEnvFile(): Promise<void> {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(path.join(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
        if (!match) continue;
        const key = match[1];
        let value = (match[2] ?? "").trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
      return;
    } catch {
      // Try the next candidate.
    }
  }
}

async function loadSeed(): Promise<ProfileSeed> {
  const custom = path.join(process.cwd(), "db", "profile.json");
  try {
    return JSON.parse(await readFile(custom, "utf8")) as ProfileSeed;
  } catch {
    console.warn(
      "\n  ⚠  db/profile.json not found — seeding from db/profile.example.json.\n" +
        "     Copy it, put your real details in, and re-run. The AI can only\n" +
        "     use what is in this file, so placeholders produce empty resumes.\n",
    );
    const example = path.join(process.cwd(), "db", "profile.example.json");
    return JSON.parse(await readFile(example, "utf8")) as ProfileSeed;
  }
}

async function main(): Promise<void> {
  await loadEnvFile();

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Missing DATABASE_URL. See .env.example.");
    process.exit(1);
  }

  const seed = await loadSeed();
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    const p = seed.profile;
    const text = (key: string): string | null => {
      const value = p[key];
      return typeof value === "string" && value.length > 0 ? value : null;
    };
    const required = (key: string): string => {
      const value = text(key);
      if (value === null) {
        throw new Error(`db/profile.json is missing required field "${key}"`);
      }
      return value;
    };
    const list = (key: string): string[] =>
      Array.isArray(p[key]) ? (p[key] as string[]) : [];

    await sql`
      insert into profile (
        id, full_name, email, phone, location, university, degree, major, minor,
        graduation_date, gpa, work_authorization, needs_sponsorship,
        github_url, linkedin_url, portfolio_url, target_season,
        preferred_locations, target_categories, target_companies, summary,
        updated_at
      ) values (
        1, ${required("fullName")}, ${required("email")}, ${text("phone")},
        ${text("location")}, ${required("university")}, ${required("degree")},
        ${required("major")}, ${text("minor")}, ${required("graduationDate")},
        ${text("gpa")}, ${required("workAuthorization")},
        ${p.needsSponsorship === true}, ${text("githubUrl")},
        ${text("linkedinUrl")}, ${text("portfolioUrl")},
        ${text("targetSeason") ?? "Summer 2027"}, ${list("preferredLocations")},
        ${list("targetCategories")}, ${list("targetCompanies")},
        ${text("summary")}, now()
      )
      on conflict (id) do update set
        full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        location = excluded.location,
        university = excluded.university,
        degree = excluded.degree,
        major = excluded.major,
        minor = excluded.minor,
        graduation_date = excluded.graduation_date,
        gpa = excluded.gpa,
        work_authorization = excluded.work_authorization,
        needs_sponsorship = excluded.needs_sponsorship,
        github_url = excluded.github_url,
        linkedin_url = excluded.linkedin_url,
        portfolio_url = excluded.portfolio_url,
        target_season = excluded.target_season,
        preferred_locations = excluded.preferred_locations,
        target_categories = excluded.target_categories,
        target_companies = excluded.target_companies,
        summary = excluded.summary,
        updated_at = now()
    `;
    console.log(`  ✓ profile: ${required("fullName")}`);

    let skillCount = 0;
    for (const [index, skill] of (seed.skills ?? []).entries()) {
      await sql`
        insert into skills (name, category, proficiency, years, display_order)
        values (
          ${skill.name}, ${skill.category}, ${skill.proficiency ?? 3},
          ${skill.years ?? null}, ${index}
        )
        on conflict (lower(name)) do update set
          category = excluded.category,
          proficiency = excluded.proficiency,
          years = excluded.years,
          display_order = excluded.display_order,
          is_active = true,
          updated_at = now()
      `;
      skillCount += 1;
    }
    console.log(`  ✓ skills: ${skillCount}`);

    let experienceCount = 0;
    let bulletCount = 0;

    for (const [index, experience] of (seed.experiences ?? []).entries()) {
      // Match on organization+title so re-seeding edits instead of duplicating.
      const existing = await sql<{ id: number }[]>`
        select id from experiences
        where organization = ${experience.organization}
          and title = ${experience.title}
        limit 1
      `;

      let experienceId: number;
      if (existing[0]) {
        experienceId = existing[0].id;
        await sql`
          update experiences set
            kind = ${experience.kind},
            location = ${experience.location ?? null},
            start_date = ${experience.startDate},
            end_date = ${experience.endDate ?? null},
            is_current = ${experience.isCurrent === true},
            description = ${experience.description ?? null},
            technologies = ${experience.technologies ?? []},
            categories = ${experience.categories ?? []},
            url = ${experience.url ?? null},
            display_order = ${experience.displayOrder ?? index},
            is_active = true,
            updated_at = now()
          where id = ${experienceId}
        `;
      } else {
        const inserted = await sql<{ id: number }[]>`
          insert into experiences (
            kind, organization, title, location, start_date, end_date,
            is_current, description, technologies, categories, url, display_order
          ) values (
            ${experience.kind}, ${experience.organization}, ${experience.title},
            ${experience.location ?? null}, ${experience.startDate},
            ${experience.endDate ?? null}, ${experience.isCurrent === true},
            ${experience.description ?? null}, ${experience.technologies ?? []},
            ${experience.categories ?? []}, ${experience.url ?? null},
            ${experience.displayOrder ?? index}
          )
          returning id
        `;
        const row = inserted[0];
        if (!row) throw new Error(`Failed to insert ${experience.organization}`);
        experienceId = row.id;
      }
      experienceCount += 1;

      for (const [order, bullet] of (experience.bullets ?? []).entries()) {
        const existingBullet = await sql<{ id: number }[]>`
          select id from resume_bullets
          where experience_id = ${experienceId}
            and canonical_text = ${bullet.canonicalText}
          limit 1
        `;

        if (existingBullet[0]) {
          await sql`
            update resume_bullets set
              skills = ${bullet.skills ?? []},
              technologies = ${bullet.technologies ?? []},
              metrics = ${bullet.metrics ?? []},
              keywords = ${bullet.keywords ?? []},
              categories = ${bullet.categories ?? []},
              strength = ${bullet.strength ?? 5},
              display_order = ${order},
              is_active = true,
              updated_at = now()
            where id = ${existingBullet[0].id}
          `;
        } else {
          await sql`
            insert into resume_bullets (
              experience_id, canonical_text, skills, technologies, metrics,
              keywords, categories, strength, display_order
            ) values (
              ${experienceId}, ${bullet.canonicalText}, ${bullet.skills ?? []},
              ${bullet.technologies ?? []}, ${bullet.metrics ?? []},
              ${bullet.keywords ?? []}, ${bullet.categories ?? []},
              ${bullet.strength ?? 5}, ${order}
            )
          `;
        }
        bulletCount += 1;
      }
    }

    console.log(`  ✓ experiences: ${experienceCount}`);
    console.log(`  ✓ bullets: ${bulletCount}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("\nSeed failed:\n", error);
  process.exit(1);
});
