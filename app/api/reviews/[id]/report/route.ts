import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/app/api/auth/authOptions";
import { getClientIp, rateLimiters, retryAfterSeconds } from "@/lib/rate-limit";
import { reviewReason } from "@/lib/reviews/text";

/**
 * A shop owner reports a review on their own product.
 *
 * The review is not edited and not deleted. Hiding it is an admin action.
 * One report per owner: a second one updates the reason they already sent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = rateLimiters.reviewReport(getClientIp(req));
  if (!limit.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit.resetTime)) } }
    );
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const reason = reviewReason(payload && typeof payload === "object" ? (payload as { reason?: unknown }).reason : undefined);
  if (!reason) return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    const { id } = await params;
    const review = await prisma.productReview.findUnique({
      where: { id },
      select: { id: true, product: { select: { shopId: true } } },
    });
    if (!review) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const membership = await prisma.shopUser.findFirst({
      where: {
        shopId: review.product.shopId,
        user: { email: { equals: email, mode: "insensitive" } },
      },
      select: { userId: true, role: true },
    });
    if (membership?.role === "OWNER") {
      await prisma.productReviewReport.upsert({
        where: { reviewId_reporterUserId: { reviewId: review.id, reporterUserId: membership.userId } },
        create: { reviewId: review.id, reporterUserId: membership.userId, reason },
        update: { reason },
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } catch (error) {
    console.error("Review report failed:", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "error" }, { status: 500 });
  }
}
