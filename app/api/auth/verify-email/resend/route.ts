import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/validations";
import { issueVerificationToken, verificationUrl } from "@/lib/auth/email-verification";
import { sendVerificationEmail } from "@/lib/email";
import { afterResponse } from "@/lib/after-response";

/**
 * POST /api/auth/verify-email/resend  { email }
 *
 * Sends a fresh verification link to an unverified account, revoking the old
 * one. The answer is identical whether the address has an account, is already
 * verified, or the send failed, so this cannot be used to learn who is
 * registered.
 *
 * Its timing is identical too: the lookup, the new token and the email all
 * happen after the response is sent. Done inline, only an unverified account
 * would have paid for a token write and a send, and the slower answer would
 * have given it away.
 *
 * Two budgets: per IP, and per address, so one address cannot be flooded from
 * many IPs. The per-address limit is applied whether or not the account
 * exists, so a refusal reveals nothing either.
 */

const GENERIC = { message: "If that account needs verifying, we have sent a new link." };
const PER_IP = { windowMs: 60 * 60 * 1000, maxRequests: 5 };
const PER_ADDRESS = { windowMs: 60 * 60 * 1000, maxRequests: 3 };

export async function POST(req: Request) {
  if (!rateLimit(`verify-resend:${getClientIp(req)}`, PER_IP).success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Same email rules as "forgot password": validated, trimmed, lowercased.
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const { email } = parsed.data;

  if (!rateLimit(`verify-resend-address:${email}`, PER_ADDRESS).success) {
    return NextResponse.json(GENERIC);
  }

  afterResponse(() => resendIfUnverified(email));
  return NextResponse.json(GENERIC);
}

async function resendIfUnverified(email: string): Promise<void> {
  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, emailVerified: true },
    });
    if (user && !user.emailVerified) {
      const token = await issueVerificationToken(user);
      const delivered = await sendVerificationEmail({ to: user.email, url: verificationUrl(token) });
      // The requester was already answered and must not learn the outcome, so
      // a failed send is recorded for the operator instead. The page keeps its
      // "send again" button, so the user can retry. No address in the log.
      if (!delivered) console.error("[verify-email] resend not delivered");
    }
  } catch (error) {
    console.error("[verify-email] resend failed", (error as Error)?.name);
  }
}
