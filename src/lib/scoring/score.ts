import "server-only";
import { z } from "zod";
import { sql } from "../db";
import { complete, modelFor } from "../ai/client";
import { hashText } from "../jobs/normalize";
import {
  renderProfileForPrompt,
  type ProfileContext,
} from "../profile/context";
import {
  COMPONENT_KEYS,
  applyCompanyPreference,
  weightsHash,
  type ScoringWeights,
} from "./weights";
import type { Job, JobScore, ScoreComponents } from "../types";

/**
 * The AI fit engine.
 *
 * Given a job that survived the deterministic prefilter, produce a 0-100 score
 * with a per-component breakdown, plus the qualitative fields the UI needs to
 * explain itself: which experience matches, what's missing, what to emphasise.
 *
 * Scores are cached on (job, weights, description) so re-running discovery over
 * an unchanged listing costs nothing.
 */

const ComponentSchema = z.object({
  score: z.number(),
  reason: z.string(),
});

const ScoreResponseSchema = z.object({
  technical: ComponentSchema,
  experience: ComponentSchema,
  education: ComponentSchema,
  role: ComponentSchema,
  location: ComponentSchema,
  eligibility: ComponentSchema,
  summary: z.string(),
  strongestExperienceIds: z.array(z.number()).default([]),
  strongestSkills: z.array(z.string()).default([]),
  missingRequirements: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  emphasize: z.array(z.string()).default([]),
});

type ScoreResponse = z.infer<typeof ScoreResponseSchema>;

const SYSTEM_PROMPT = `You score how well a specific internship posting fits one specific candidate.

Rules:
- Judge ONLY against the candidate record you are given. Never assume skills, coursework, or experience that is not listed.
- Score each component out of the maximum given. Be calibrated, not generous: an average-fit job should land near 60-70, not 85.
- "reason" must cite concrete evidence from the posting and the candidate record — technology names, requirements, dates — in one short sentence. No filler.
- strongestExperienceIds must be ids from the [exp:N] markers in the candidate record. Never invent an id.
- missingRequirements lists things the posting asks for that the candidate genuinely lacks. An empty list is a real answer; do not manufacture concerns.
- emphasize lists which of the candidate's experiences or technologies a tailored resume should lead with for this posting.`;

export interface ScoreJobInput {
  job: Pick<
    Job,
    | "id"
    | "title"
    | "description"
    | "requirements"
    | "preferredQualifications"
    | "locationRaw"
    | "season"
    | "descriptionHash"
  >;
  companyName: string;
  companyPreference: number;
  context: ProfileContext;
  weights: ScoringWeights;
}

/**
 * Score a job, reusing a cached score when the weights and description are
 * unchanged. Returns the stored row either way.
 */
export async function scoreJob(input: ScoreJobInput): Promise<JobScore> {
  const { job, weights } = input;

  const descriptionHash =
    job.descriptionHash ?? hashText(job.description ?? job.title);
  const wHash = weightsHash(weights);

  const cached = await sql<JobScore[]>`
    select * from job_scores
    where job_id = ${job.id}
      and weights_hash = ${wHash}
      and description_hash = ${descriptionHash}
    limit 1
  `;
  const hit = cached[0];
  if (hit) return hit;

  const response = await complete({
    purpose: "score",
    tier: "cheap",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(input),
    schema: ScoreResponseSchema,
    schemaName: "JobFitScore",
    temperature: 0.1,
    maxOutputTokens: 1200,
    jobId: job.id,
  });

  const components = clampComponents(response, weights);
  const rawTotal = COMPONENT_KEYS.reduce(
    (sum, key) => sum + components[key].score,
    0,
  );
  const total = applyCompanyPreference(
    rawTotal,
    input.companyPreference,
    weights,
  );

  // Only keep experience ids that actually exist — the model is told not to
  // invent them, but the database is where that gets enforced.
  const validExperienceIds = new Set(input.context.experiences.map((e) => e.id));
  const strongestExperienceIds = response.strongestExperienceIds.filter((id) =>
    validExperienceIds.has(id),
  );

  const inserted = await sql<JobScore[]>`
    insert into job_scores (
      job_id, total, components, summary, strongest_experience_ids,
      strongest_skills, missing_requirements, concerns, emphasize,
      weights_hash, description_hash, model
    ) values (
      ${job.id}, ${total}, ${sql.json(components)}, ${response.summary},
      ${strongestExperienceIds}, ${response.strongestSkills.slice(0, 8)},
      ${response.missingRequirements.slice(0, 8)},
      ${response.concerns.slice(0, 6)}, ${response.emphasize.slice(0, 8)},
      ${wHash}, ${descriptionHash}, ${modelFor("cheap")}
    )
    on conflict (job_id, weights_hash, description_hash) do update
      set total = excluded.total
    returning *
  `;

  const row = inserted[0];
  if (!row) throw new Error(`Failed to persist score for job ${job.id}`);
  return row;
}

function buildUserPrompt(input: ScoreJobInput): string {
  const { job, companyName, weights, context } = input;

  const maxima = COMPONENT_KEYS.map(
    (key) => `  ${key}: max ${weights[key]} points`,
  ).join("\n");

  // Long descriptions are mostly boilerplate after the first few thousand
  // characters, and every character is billed on every job.
  const description = (job.description ?? "").slice(0, 6000);

  return [
    "CANDIDATE RECORD (the only facts you may use):",
    renderProfileForPrompt(context),
    "",
    "POSTING:",
    `Company: ${companyName}`,
    `Title: ${job.title}`,
    `Location: ${job.locationRaw ?? "unspecified"}`,
    `Season: ${job.season ?? "unspecified"}`,
    "",
    "Description:",
    description || "(no description available)",
    job.requirements ? `\nRequirements:\n${job.requirements.slice(0, 2000)}` : "",
    job.preferredQualifications
      ? `\nPreferred:\n${job.preferredQualifications.slice(0, 1500)}`
      : "",
    "",
    "COMPONENT MAXIMA:",
    maxima,
    "",
    'Return JSON: {"technical":{"score":N,"reason":"..."}, "experience":{...}, "education":{...}, "role":{...}, "location":{...}, "eligibility":{...}, "summary":"one sentence on why this fits or does not", "strongestExperienceIds":[N], "strongestSkills":["..."], "missingRequirements":["..."], "concerns":["..."], "emphasize":["..."]}',
  ].join("\n");
}

/** Clamp every component into 0..max so a hallucinated 99/10 can't happen. */
function clampComponents(
  response: ScoreResponse,
  weights: ScoringWeights,
): ScoreComponents {
  const components = {} as ScoreComponents;
  for (const key of COMPONENT_KEYS) {
    const max = weights[key];
    const raw = response[key];
    components[key] = {
      score: Math.max(0, Math.min(max, Math.round(raw.score))),
      max,
      reason: raw.reason.slice(0, 240),
    };
  }
  return components;
}
