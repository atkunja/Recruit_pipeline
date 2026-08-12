import "server-only";
import { z } from "zod";
import { complete, modelFor } from "../ai/client";
import type { ProfileContext } from "../profile/context";
import { assembleResume, type EntrySelection } from "./assemble";
import { checkIntegrity } from "./integrity";
import type {
  IntegrityReport,
  ResumeChange,
  ResumeDocument,
  ResumeRationale,
} from "./types";
import type { Job, JobScore } from "../types";

/**
 * AI resume tailoring.
 *
 * The model is given the verified bullet bank and the job, and returns three
 * things: which experiences to include and in what order, which bullets to use
 * (optionally reworded), and which skills to lead with. It never returns an
 * employer, a title, a date, or a metric — those come from the database when
 * the document is assembled.
 *
 * Output is run through `checkIntegrity`. If the model fabricated anything, we
 * retry once with the specific violations quoted back at it, and if it fails
 * again we fall back to canonical wording rather than shipping a lie.
 */

const SelectionSchema = z.object({
  experienceId: z.number(),
  bullets: z.array(
    z.object({
      bulletId: z.number(),
      text: z.string().optional(),
      why: z.string().optional(),
    }),
  ),
  why: z.string().optional(),
});

const TailorResponseSchema = z.object({
  selections: z.array(SelectionSchema),
  skillOrder: z.array(z.string()).default([]),
  omitted: z
    .array(z.object({ experienceId: z.number(), why: z.string() }))
    .default([]),
  summary: z.string(),
});

const SYSTEM_PROMPT = `You tailor one candidate's resume to one job posting.

YOU MAY:
- choose which experiences to include and their order
- choose which bullets to include and their order
- reword a bullet to be shorter, sharper, or to lead with the technology this job cares about
- reorder skills so the most relevant appear first

YOU MAY NOT, under any circumstance:
- invent or change a number, percentage, duration, or any other metric
- mention a technology that does not already appear in that bullet's verified text or in the candidate's verified skill list
- invent responsibilities, accomplishments, employers, titles, dates, or education details
- make a claim stronger than the verified text supports ("led" when the source says "contributed to")

A reworded bullet must be a faithful compression or rephrasing of its verified text. If you cannot improve a bullet without adding something, return it unchanged by omitting "text".

Aim for a single page: roughly 3-4 experiences and 3-5 bullets each. Prefer cutting weak bullets over shortening strong ones into vagueness.

Reference bullets by the [b:N] ids and experiences by the [exp:N] ids in the candidate record.`;

export interface TailorInput {
  context: ProfileContext;
  job: Pick<
    Job,
    "id" | "title" | "description" | "requirements" | "preferredQualifications"
  >;
  companyName: string;
  score?: Pick<JobScore, "emphasize" | "strongestExperienceIds" | "missingRequirements"> | null;
}

export interface TailorResult {
  document: ResumeDocument;
  rationale: ResumeRationale;
  integrity: IntegrityReport;
  bulletIds: number[];
  model: string;
  /** True when fabrication forced us back to canonical wording. */
  fellBackToCanonical: boolean;
}

export async function tailorResume(input: TailorInput): Promise<TailorResult> {
  const first = await requestTailoring(input, null);
  if (first.integrity.ok) return first;

  // Give the model one chance to fix exactly what it got wrong.
  const retry = await requestTailoring(input, first.integrity.issues);
  if (retry.integrity.ok) return retry;

  // Still fabricating: keep its structural choices, throw away its wording.
  const canonical = buildFromSelections(
    input.context,
    retry.selections.map((selection) => ({
      experienceId: selection.experienceId,
      // Dropping `text` makes assembleResume fall back to canonical_text.
      bullets: selection.bullets.map((bullet) => ({ bulletId: bullet.bulletId })),
    })),
    retry.skillOrder,
  );

  return {
    document: canonical.document,
    rationale: {
      summary:
        `${retry.rationale.summary} (Reworded bullets were rejected by the ` +
        `integrity check and reverted to their verified wording.)`,
      changes: canonical.changes,
    },
    integrity: canonical.integrity,
    bulletIds: canonical.bulletIds,
    model: modelFor("strong"),
    fellBackToCanonical: true,
  };
}

interface TailoringAttempt extends TailorResult {
  selections: EntrySelection[];
  skillOrder: string[];
}

async function requestTailoring(
  input: TailorInput,
  previousIssues: string[] | null,
): Promise<TailoringAttempt> {
  const response = await complete({
    purpose: "tailor",
    tier: "strong",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(input, previousIssues),
    schema: TailorResponseSchema,
    schemaName: "TailoredResume",
    temperature: previousIssues === null ? 0.35 : 0.1,
    maxOutputTokens: 2600,
    jobId: input.job.id,
  });

  const selections: EntrySelection[] = response.selections.map((selection) => ({
    experienceId: selection.experienceId,
    bullets: selection.bullets.map((bullet) => ({
      bulletId: bullet.bulletId,
      text: bullet.text,
    })),
  }));

  const built = buildFromSelections(input.context, selections, response.skillOrder);

  // Explain the omissions the model made, using its own reasoning.
  const changes: ResumeChange[] = [...built.changes];
  for (const omission of response.omitted) {
    changes.push({
      kind: "experience_omitted",
      experienceId: omission.experienceId,
      why: omission.why,
    });
  }
  for (const selection of response.selections) {
    for (const bullet of selection.bullets) {
      if (bullet.why === undefined || bullet.text === undefined) continue;
      const change = changes.find(
        (candidate) =>
          candidate.kind === "bullet_rewritten" && candidate.bulletId === bullet.bulletId,
      );
      if (change) change.why = bullet.why;
    }
  }

  return {
    document: built.document,
    rationale: { summary: response.summary, changes },
    integrity: built.integrity,
    bulletIds: built.bulletIds,
    model: modelFor("strong"),
    fellBackToCanonical: false,
    selections,
    skillOrder: response.skillOrder,
  };
}

/** Assemble, diff against the master, and run the integrity check. */
function buildFromSelections(
  context: ProfileContext,
  selections: EntrySelection[],
  skillOrder: string[],
) {
  const document = assembleResume(context, { selections, skillOrder });
  const master = assembleResume(context);

  const integrity = checkIntegrity({
    document,
    bullets: context.bullets,
    experiences: context.experiences,
    skills: context.skills,
  });

  const bulletIds: number[] = [];
  for (const section of document.sections) {
    for (const entry of section.entries) {
      for (const line of entry.bullets) bulletIds.push(line.bulletId);
    }
  }

  return {
    document,
    integrity,
    bulletIds,
    changes: diffAgainstMaster(master, document, context),
  };
}

/** Every difference between the master resume and this version. */
export function diffAgainstMaster(
  master: ResumeDocument,
  tailored: ResumeDocument,
  context: ProfileContext,
): ResumeChange[] {
  const changes: ResumeChange[] = [];

  const canonicalById = new Map(
    context.bullets.map((bullet) => [bullet.id, bullet.canonicalText]),
  );

  const masterBulletIds = new Set<number>();
  for (const section of master.sections) {
    for (const entry of section.entries) {
      for (const line of entry.bullets) masterBulletIds.add(line.bulletId);
    }
  }

  const tailoredBulletIds = new Set<number>();
  for (const section of tailored.sections) {
    for (const entry of section.entries) {
      for (const line of entry.bullets) {
        tailoredBulletIds.add(line.bulletId);
        if (line.rewritten) {
          changes.push({
            kind: "bullet_rewritten",
            experienceId: entry.experienceId,
            bulletId: line.bulletId,
            before: canonicalById.get(line.bulletId),
            after: line.text,
            why: "Reworded for this posting",
          });
        }
      }
    }
  }

  for (const bulletId of masterBulletIds) {
    if (!tailoredBulletIds.has(bulletId)) {
      changes.push({
        kind: "bullet_omitted",
        bulletId,
        before: canonicalById.get(bulletId),
        why: "Cut to keep the resume to one page",
      });
    }
  }

  return changes;
}

function buildUserPrompt(
  input: TailorInput,
  previousIssues: string[] | null,
): string {
  const parts: string[] = [];

  if (previousIssues !== null) {
    parts.push(
      "YOUR PREVIOUS ATTEMPT WAS REJECTED. Each line below is something you " +
        "wrote that is not supported by the verified text. Fix these by using " +
        "the verified wording; do not restate them differently.",
      ...previousIssues.slice(0, 10).map((issue) => `- ${issue}`),
      "",
    );
  }

  parts.push(
    "CANDIDATE RECORD (the only facts you may use):",
    renderBulletBank(input.context),
    "",
    "TARGET POSTING:",
    `Company: ${input.companyName}`,
    `Title: ${input.job.title}`,
    "",
    (input.job.description ?? "").slice(0, 5000) || "(no description)",
  );

  if (input.job.requirements) {
    parts.push("", "Requirements:", input.job.requirements.slice(0, 1800));
  }
  if (input.score?.emphasize?.length) {
    parts.push("", `Scoring pass suggests emphasising: ${input.score.emphasize.join(", ")}`);
  }
  if (input.score?.missingRequirements?.length) {
    parts.push(
      `Known gaps (do NOT paper over these by inventing anything): ${input.score.missingRequirements.join(", ")}`,
    );
  }

  parts.push(
    "",
    'Return JSON: {"selections":[{"experienceId":N,"why":"...","bullets":[{"bulletId":N,"text":"optional rewrite","why":"..."}]}],"skillOrder":["..."],"omitted":[{"experienceId":N,"why":"..."}],"summary":"one or two sentences on the strategy"}',
  );

  return parts.join("\n");
}

/** The bullet bank, rendered with the ids the model must reference. */
function renderBulletBank(context: ProfileContext): string {
  const lines: string[] = [];

  lines.push(
    `${context.profile.degree} in ${context.profile.major}, ${context.profile.university}, graduating ${context.profile.graduationDate.getUTCFullYear()}.`,
  );

  const bulletsByExperience = new Map<number, typeof context.bullets>();
  for (const bullet of context.bullets) {
    const list = bulletsByExperience.get(bullet.experienceId) ?? [];
    list.push(bullet);
    bulletsByExperience.set(bullet.experienceId, list);
  }

  for (const experience of context.experiences) {
    lines.push(
      `\n[exp:${experience.id}] ${experience.title} @ ${experience.organization} (${experience.kind})` +
        (experience.technologies.length > 0
          ? ` — tech: ${experience.technologies.join(", ")}`
          : ""),
    );
    for (const bullet of bulletsByExperience.get(experience.id) ?? []) {
      lines.push(`  [b:${bullet.id}] (strength ${bullet.strength}) ${bullet.canonicalText}`);
    }
  }

  lines.push(
    `\nVERIFIED SKILLS (the only technologies you may name): ${context.skills
      .map((skill) => skill.name)
      .join(", ")}`,
  );

  return lines.join("\n");
}
