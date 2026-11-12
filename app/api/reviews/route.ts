import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/authOptions";
import { accountKey, getClientIp, rateLimiters, retryAfterSeconds } from "@/lib/rate-limit";
import { authorizeReviewWrite } from "@/lib/reviews/authorize";
import { saveReview } from "@/lib/reviews/store";
import { reviewBody, reviewSubmitSchema } from "@/lib/reviews/text";

/**
 * Publish or edit a verified buyer's review.
 *
 * POST /api/reviews
 * Body: { productId, stars, body?, token? } or { productId, stars, body?, orderId? }
 *
 * The token is the signed review link. The order id is the "My purchases"
 * channel and only works for a session whose email is the email on that
 * paid order. authorizeReviewWrite is the gate: no order, an unpaid or
 * refunded order, another product or another email never writes a row.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limited(resetTime: number) {
  return NextResponse.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds(resetTime)) } }
  );
}

export async function POST(req: Request) {
  const ipLimit = rateLimiters.review(getClientIp(req));
  if (!ipLimit.success) return limited(ipLimit.resetTime);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = reviewSubmitSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { productId, stars, body, token, orderId } = parsed.data;
  if (!token && !orderId) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const text = reviewBody(body);
  if (!text.ok) return NextResponse.json({ error: text.error }, { status: 400 });

  try {
    const session = token ? null : await getServerSession(authOptions);
    const auth = await authorizeReviewWrite({
      productId,
      token,
      orderId,
      sessionEmail: session?.user?.email ?? null,
      secret: process.env.NEXTAUTH_SECRET,
    });
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const accountLimit = rateLimiters.reviewAccount(accountKey(auth.email));
    if (!accountLimit.success) return limited(accountLimit.resetTime);

    const saved = await saveReview({
      orderId: auth.orderId,
      productId: auth.productId,
      email: auth.email,
      stars,
      body: text.text,
    });
    return NextResponse.json({ ok: true, created: saved.created });
  } catch (error) {
    console.error("Review submit failed:", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "error" }, { status: 500 });
  }
}
