import { NextResponse } from "next/server";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { verifyEmailWithToken } from "@/lib/auth/email-verification";

/**
 * POST /api/auth/verify-email  { token, password }
 *
 * Confirms an address. Requires the emailed token AND the account's password;
 * lib/auth/email-verification.ts explains why the token alone is not enough.
 *
 * A POST, not the link itself: mail scanners and link previews fetch GET
 * links, and they must not be able to spend a token. The link opens a page,
 * and the page posts here.
 *
 * Limited with the same per-IP budget as sign-in, because a wrong password is
 * an answer an attacker holding a token would like to repeat.
 */
export async function POST(req: Request) {
  if (!rateLimiters.auth(getClientIp(req)).success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { token?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  try {
    const outcome = await verifyEmailWithToken({ token: body?.token, password: body?.password });
    if (outcome === "verified") {
      return NextResponse.json({ status: "verified" });
    }
    return NextResponse.json({ error: outcome }, { status: 400 });
  } catch (error) {
    console.error("[verify-email] failed", (error as Error)?.name);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
