import { NextResponse } from "next/server";
import { BudgetExceededError } from "./ai/budget";

/** Shared route-handler plumbing: consistent errors and param parsing. */

export function ok<T>(data: T): NextResponse {
  return NextResponse.json(data satisfies T);
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

/**
 * Convert a thrown value into a response.
 *
 * Budget exhaustion is the one case that gets its own status code: the UI
 * shows it as "you've hit your spending cap", not as a generic failure.
 */
export function handleError(error: unknown, context: string): NextResponse {
  if (error instanceof BudgetExceededError) {
    return NextResponse.json(
      { error: error.message, code: "budget_exceeded" },
      { status: 402 },
    );
  }

  console.error(`[${context}]`, error);
  const message =
    error instanceof Error ? error.message : "Unexpected server error";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Parse a numeric route param, or null when it isn't one. */
export function numericParam(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Read a JSON body, tolerating an empty one. */
export async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    const body: unknown = await request.json();
    return (body ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}
