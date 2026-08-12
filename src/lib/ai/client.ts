import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { env } from "../env";
import { costOf } from "./pricing";
import { assertWithinBudget, recordUsage } from "./budget";

/**
 * The single entry point for every model call.
 *
 * Enforces four things no call site should have to remember:
 *   1. the monthly budget guard runs first,
 *   2. output is validated against a Zod schema before anyone sees it,
 *   3. token cost is written to the usage ledger even when the call fails,
 *   4. transient errors are retried with backoff, and only those.
 */

const globalForOpenAi = globalThis as unknown as { __openai?: OpenAI };

function client(): OpenAI {
  const existing = globalForOpenAi.__openai;
  if (existing) return existing;
  const created = new OpenAI({
    apiKey: env.openaiApiKey,
    // Undefined means OpenAI's own endpoint; set OPENAI_BASE_URL to point at
    // any OpenAI-compatible provider instead.
    baseURL: env.openaiBaseUrl,
    maxRetries: 0,
  });
  globalForOpenAi.__openai = created;
  return created;
}

export type ModelTier = "cheap" | "strong";

export function modelFor(tier: ModelTier): string {
  return tier === "strong" ? env.modelStrong : env.modelCheap;
}

export interface CompleteOptions<T> {
  /** Ledger label, e.g. "score" | "tailor" | "outreach". */
  purpose: string;
  tier: ModelTier;
  system: string;
  user: string;
  /** Shape the model must return. Validated; a mismatch is retried once. */
  schema: z.ZodType<T>;
  /** Name given to the JSON schema in the request. */
  schemaName: string;
  temperature?: number;
  maxOutputTokens?: number;
  jobId?: number | null;
}

export class AiError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AiError";
    this.cause = cause;
  }
}

const MAX_ATTEMPTS = 3;

/**
 * Call the model and return a value matching `schema`.
 *
 * Uses JSON mode plus explicit schema instructions rather than the provider's
 * strict structured-output mode, because strict mode rejects several shapes we
 * want (optional fields, unions) and we validate with Zod regardless.
 */
export async function complete<T>(options: CompleteOptions<T>): Promise<T> {
  await assertWithinBudget();

  const model = modelFor(options.tier);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await client().chat.completions.create({
        model,
        temperature: options.temperature ?? 0.2,
        max_completion_tokens: options.maxOutputTokens ?? 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
      });

      const usage = response.usage;
      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;

      await recordUsage({
        purpose: options.purpose,
        model,
        promptTokens,
        completionTokens,
        cachedTokens,
        costUsd: costOf(model, promptTokens, completionTokens, cachedTokens),
        jobId: options.jobId ?? null,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new AiError("Model returned an empty response");

      const parsed: unknown = JSON.parse(content);
      const result = options.schema.safeParse(parsed);
      if (result.success) return result.data;

      // A schema mismatch is worth one more try; the model usually corrects
      // itself when the same prompt is re-run.
      lastError = new AiError(
        `Model output did not match ${options.schemaName}: ${result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .slice(0, 5)
          .join("; ")}`,
      );
      if (attempt === MAX_ATTEMPTS) break;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      // 0.5s, 1s, 2s — enough for a rate limit to clear without stalling a
      // batch of thirty jobs.
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  await recordUsage({
    purpose: options.purpose,
    model,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    jobId: options.jobId ?? null,
    ok: false,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });

  throw lastError instanceof AiError
    ? lastError
    : new AiError(
        `AI call "${options.purpose}" failed after ${MAX_ATTEMPTS} attempts`,
        lastError,
      );
}

/** Rate limits and 5xx are worth retrying; a 400 or an auth failure is not. */
function isRetryable(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  // Network-level failures surface as plain Errors with these codes.
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render a Zod schema's expected shape into the prompt.
 *
 * Models follow a concrete example far more reliably than a prose description,
 * so every prompt ends with one.
 */
export function schemaHint(example: unknown): string {
  return `Return ONLY a JSON object matching this shape exactly:\n${JSON.stringify(
    example,
    null,
    2,
  )}`;
}
