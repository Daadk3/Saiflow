/**
 * Short-lived proof that the person checked both sign-up boxes before Google
 * sends them away.
 *
 * Email sign-up posts the two flags on the create request, and the server
 * refuses to insert a row unless both are true. Google sign-up leaves this
 * origin, so the checks are signed into an httpOnly cookie first. The Google
 * callback creates a user only when that cookie is still valid. An existing
 * account can sign in without it.
 *
 * The cookie is not a session. It only says "these boxes were checked for
 * POLICY_VERSION, recently, on this browser."
 */

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { POLICY_VERSION } from "@/lib/policy";

export const SIGNUP_CONSENT_COOKIE = "sf_signup_consent";
/** Long enough to finish the Google redirect, short enough to expire if they leave. */
export const SIGNUP_CONSENT_MAX_AGE_SECONDS = 15 * 60;

interface ConsentPayload {
  v: string;
  exp: number;
  terms: true;
  age: true;
}

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) {
    throw new Error("NEXTAUTH_SECRET is not set");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Signed token recording that both boxes were checked for the current policy version. */
export function signSignupConsent(now = Date.now()): string {
  const body: ConsentPayload = {
    v: POLICY_VERSION,
    exp: now + SIGNUP_CONSENT_MAX_AGE_SECONDS * 1000,
    terms: true,
    age: true,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** True only for an unexpired token of the current policy version, with both flags set. */
export function verifySignupConsent(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }
  if (!safeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<ConsentPayload>;
    return (
      data.v === POLICY_VERSION &&
      data.terms === true &&
      data.age === true &&
      typeof data.exp === "number" &&
      data.exp > now
    );
  } catch {
    return false;
  }
}

/**
 * Reads and clears the consent cookie. Missing, forged, expired, or unreadable
 * cookies are a refusal, so a new Google account is not created.
 */
export async function consumeSignupConsent(now = Date.now()): Promise<boolean> {
  try {
    const jar = await cookies();
    const token = jar.get(SIGNUP_CONSENT_COOKIE)?.value;
    const ok = verifySignupConsent(token, now);
    if (token) {
      try {
        jar.delete(SIGNUP_CONSENT_COOKIE);
      } catch {
        // A valid consent still counts if the jar cannot drop the cookie.
      }
    }
    return ok;
  } catch {
    return false;
  }
}
