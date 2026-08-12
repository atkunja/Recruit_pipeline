import "server-only";
import { gmailFetch } from "./client";

/**
 * Sending mail.
 *
 * Gmail takes a base64url-encoded RFC 2822 message. Building it by hand keeps
 * the dependency count at zero and makes threading explicit.
 */

export interface SendMessageInput {
  to: string;
  subject: string;
  body: string;
  fromName?: string | null;
  /** Set to keep a follow-up in the same conversation. */
  threadId?: string | null;
  /** Message-ID of the message being replied to, for proper threading. */
  inReplyTo?: string | null;
}

export interface SentMessage {
  messageId: string;
  threadId: string;
}

export async function sendEmail(input: SendMessageInput): Promise<SentMessage> {
  const raw = buildMime(input);

  const response = await gmailFetch<{ id: string; threadId: string }>(
    "/messages/send",
    {
      method: "POST",
      body: JSON.stringify({
        raw: base64Url(raw),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }),
    },
  );

  return { messageId: response.id, threadId: response.threadId };
}

/** Assemble the RFC 2822 message. */
export function buildMime(input: SendMessageInput): string {
  const headers: string[] = [
    `To: ${sanitizeHeader(input.to)}`,
    `Subject: ${encodeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];

  if (input.inReplyTo) {
    const reference = sanitizeHeader(input.inReplyTo);
    headers.push(`In-Reply-To: ${reference}`, `References: ${reference}`);
  }

  return `${headers.join("\r\n")}\r\n\r\n${input.body.replace(/\r?\n/g, "\r\n")}`;
}

/**
 * Strip CR/LF from header values.
 * Without this, a newline in a subject or recipient would let the rest of that
 * string inject arbitrary headers (Bcc, Reply-To) into the message.
 */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047 encode a subject when it isn't plain ASCII. */
function encodeSubject(subject: string): string {
  const clean = sanitizeHeader(subject);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
