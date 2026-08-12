import "server-only";
import { getSetting, setSetting } from "../settings";
import { env, isGmailConfigured } from "../env";

/**
 * Gmail OAuth and REST access.
 *
 * Implemented with plain fetch rather than `googleapis`: we need four
 * endpoints, and the SDK is a ~170MB dependency that would dominate the
 * deployment for no benefit.
 *
 * Tokens live in the `settings` table under `gmail_tokens`. Single user, so
 * there is exactly one token set.
 */

const TOKEN_KEY = "gmail_tokens";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Scopes.
 *
 * `gmail.send` can only send; it cannot read. `gmail.readonly` is needed to
 * detect replies. We deliberately do not request `gmail.modify` or full
 * `https://mail.google.com/` — nothing here should be able to delete mail.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  email: string | null;
  scope: string;
}

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected. Connect it from Settings.");
    this.name = "GmailNotConnectedError";
  }
}

/** URL that starts the OAuth consent flow. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: "code",
    scope: SCOPES,
    // Required to receive a refresh token at all.
    access_type: "offline",
    // Forces the consent screen so a re-connect always returns a refresh
    // token, instead of silently reusing a grant we no longer have stored.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange the OAuth code for tokens and persist them. */
export async function exchangeCode(code: string): Promise<StoredTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.googleRedirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app at " +
        "myaccount.google.com/permissions and connect again.",
    );
  }

  const tokens: StoredTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: null,
    scope: data.scope,
  };

  tokens.email = await fetchProfileEmail(tokens.accessToken);
  await setSetting(TOKEN_KEY, tokens);
  return tokens;
}

async function fetchProfileEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(`${API_BASE}/profile`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { emailAddress?: string };
  return data.emailAddress ?? null;
}

async function loadTokens(): Promise<StoredTokens | null> {
  const stored = await getSetting<StoredTokens | null>(TOKEN_KEY, null);
  if (stored === null || typeof stored.refreshToken !== "string") return null;
  return stored;
}

/** A valid access token, refreshed if it is close to expiring. */
async function accessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (tokens === null) throw new GmailNotConnectedError();

  // Refresh a minute early so a token doesn't expire mid-request.
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Could not refresh the Gmail token (${response.status}). Reconnect Gmail from Settings.`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  const updated: StoredTokens = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await setSetting(TOKEN_KEY, updated);
  return updated.accessToken;
}

/** Authenticated request against the Gmail REST API. */
export async function gmailFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      "content-type":
        (init.headers as Record<string, string> | undefined)?.["content-type"] ??
        "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Gmail API ${path} failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  canSend: boolean;
  canRead: boolean;
}

export async function gmailStatus(): Promise<GmailStatus> {
  const configured = isGmailConfigured();
  if (!configured) {
    return { configured, connected: false, email: null, canSend: false, canRead: false };
  }

  const tokens = await loadTokens();
  return {
    configured,
    connected: tokens !== null,
    email: tokens?.email ?? null,
    canSend: tokens?.scope.includes("gmail.send") ?? false,
    canRead: tokens?.scope.includes("gmail.readonly") ?? false,
  };
}

export async function disconnectGmail(): Promise<void> {
  await setSetting(TOKEN_KEY, null);
}
