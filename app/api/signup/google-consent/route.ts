import { NextResponse } from "next/server";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { signupConsentSchema, formatZodError } from "@/lib/validations";
import {
  SIGNUP_CONSENT_COOKIE,
  SIGNUP_CONSENT_MAX_AGE_SECONDS,
  signSignupConsent,
} from "@/lib/signup-consent";

/**
 * Sets the cookie the Google sign-in callback requires before it will create
 * an account. Both boxes must already be true; this route does not create a user.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rateLimitResult = rateLimiters.auth(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again in a minute." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)),
        },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const parsed = signupConsentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  let token: string;
  try {
    token = signSignupConsent();
  } catch (error) {
    console.error("Signup consent cookie:", error instanceof Error ? error.message : "unavailable");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SIGNUP_CONSENT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SIGNUP_CONSENT_MAX_AGE_SECONDS,
  });
  return res;
}
