/**
 * The founder bot's door.
 *
 * One bearer token, compared in constant time with the cron worker's rules
 * (app/api/internal/scan). No token, a blank token, a token shorter than 16
 * characters, or a token that contains whitespace: the API does not exist
 * (404). A wrong token is 403. The token is never written to a log.
 *
 * The account the bot may act as is FOUNDER_BOT_OWNER_EMAIL, and only when
 * that address is on BOTH ADMIN_EMAILS and FOUNDER_TEST_EMAILS. Anything else
 * is refused. The bot cannot name a different user.
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { isAdminEmail } from "@/lib/admin";
import { parseFounderEmails } from "@/lib/payments/live-mode";
import { accountKey, getClientIp, rateLimiters, retryAfterSeconds } from "@/lib/rate-limit";

/** Shorter than this, the secret is treated as unset and the API stays off. */
const MIN_TOKEN_LENGTH = 16;

export type FounderBotGate =
  | { ok: true; email: string }
  | { ok: false; response: NextResponse };

/**
 * The configured token, or null when the API must stay disabled.
 *
 * Trimmed once. Internal whitespace is not trimmed away: a token with a space
 * in it is unset, so a wrapped secret cannot become a credential.
 */
export function founderBotToken(): string | null {
  const raw = process.env.FOUNDER_BOT_API_TOKEN;
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH) return null;
  if (/\s/.test(token)) return null;
  return token;
}

/**
 * Constant-time string comparison.
 *
 * The length guard is required: `timingSafeEqual` throws when the buffers
 * differ in length, and a throw here would become a 500 instead of a refusal.
 * Same rule as the scan worker.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = Buffer.from(a, "utf8");
  const bBytes = Buffer.from(b, "utf8");
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(aBytes, bBytes);
}

function bearerMatches(req: Request, token: string): boolean {
  const header = req.headers.get("authorization");
  if (header === null) return false;
  return timingSafeEqualStrings(header, `Bearer ${token}`);
}

/**
 * The only account the bot may act as.
 *
 * Both lists, not either. An address that is an admin but not a founder-test
 * address, or the other way around, is refused. The comparison is the
 * existing parsers (`isAdminEmail`, `parseFounderEmails`), not a new one.
 */
export function founderBotOwnerEmail(): string | null {
  const raw = process.env.FOUNDER_BOT_OWNER_EMAIL;
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!isAdminEmail(email)) return null;
  if (!parseFounderEmails(process.env.FOUNDER_TEST_EMAILS).has(email)) return null;
  return email;
}

function tooMany(resetTime: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds(resetTime)) } }
  );
}

/**
 * Authenticate one founder-bot request.
 *
 * 404 when the API is off (no usable token). 403 when the token is wrong or
 * the owner address is not on both lists. 429 when the caller is over the
 * modest ceiling. The token and the Authorization header are never logged.
 */
export function authorizeFounderBot(req: Request): FounderBotGate {
  const token = founderBotToken();
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  // Guessing the token is capped per address. Checked before the comparison's
  // result is used, so a flood of wrong tokens cannot run unbounded.
  const ipLimit = rateLimiters.founderBotAuth(getClientIp(req));
  if (!ipLimit.success) return { ok: false, response: tooMany(ipLimit.resetTime) };

  if (!bearerMatches(req, token)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const email = founderBotOwnerEmail();
  if (!email) {
    // No address, no token. The operator can see that the owner var is wrong.
    console.error("[founder-bot] refused: owner is not on the admin and founder lists");
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const accountLimit = rateLimiters.founderBot(accountKey(email));
  if (!accountLimit.success) return { ok: false, response: tooMany(accountLimit.resetTime) };

  return { ok: true, email };
}
