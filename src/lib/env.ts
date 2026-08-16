/**
 * Environment access.
 *
 * Everything is read lazily. `next build` runs module top-level code, and we
 * don't want a missing Gmail credential to break a build that doesn't touch
 * Gmail — so validation happens at the point of use, not at import time.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** Read a required variable, throwing a message that names the fix. */
export function required(name: string): string {
  const value = read(name);
  if (value === undefined) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

/** Read an optional variable. */
export function optional(name: string, fallback: string): string {
  return read(name) ?? fallback;
}

function num(name: string, fallback: number): number {
  const raw = read(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  /** Session-mode connection used for DDL. Falls back to the pooler URL. */
  get directDatabaseUrl(): string {
    return read("DIRECT_DATABASE_URL") ?? required("DATABASE_URL");
  },
  get appPassword(): string {
    return required("APP_PASSWORD");
  },
  get authSecret(): string {
    return required("AUTH_SECRET");
  },
  get openaiApiKey(): string {
    return required("OPENAI_API_KEY");
  },
  /**
   * API base URL. Defaults to OpenAI's.
   *
   * Any OpenAI-compatible endpoint works — Moonshot (Kimi), Together, Groq,
   * Fireworks, OpenRouter, or a local server. Set it together with model names
   * that provider recognises, and add a price entry in ai/pricing.ts so the
   * budget guard doesn't fall back to its pessimistic default.
   */
  get openaiBaseUrl(): string | undefined {
    return read("OPENAI_BASE_URL");
  },
  get modelCheap(): string {
    return optional("OPENAI_MODEL_CHEAP", "gpt-4.1-nano");
  },
  get modelStrong(): string {
    return optional("OPENAI_MODEL_STRONG", "gpt-4.1");
  },
  /** Monthly OpenAI ceiling in USD. `0` disables the guard. */
  get monthlyBudgetUsd(): number {
    return num("OPENAI_MONTHLY_BUDGET_USD", 20);
  },
  get cronSecret(): string {
    return required("CRON_SECRET");
  },
  get googleClientId(): string {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret(): string {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get googleRedirectUri(): string {
    return optional(
      "GOOGLE_REDIRECT_URI",
      `${optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000")}/api/gmail/callback`,
    );
  },
  get appUrl(): string {
    return optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
} as const;

/** True when Gmail credentials are configured; lets the UI hide the feature. */
export function isGmailConfigured(): boolean {
  return read("GOOGLE_CLIENT_ID") !== undefined &&
    read("GOOGLE_CLIENT_SECRET") !== undefined;
}

/** True when an OpenAI key is present; lets the UI degrade gracefully. */
export function isOpenAiConfigured(): boolean {
  return read("OPENAI_API_KEY") !== undefined;
}
