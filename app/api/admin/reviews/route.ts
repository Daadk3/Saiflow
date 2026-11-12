import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/app/api/auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { getClientIp, rateLimiters, retryAfterSeconds } from "@/lib/rate-limit";
import { reviewReason } from "@/lib/reviews/text";

/**
 * Hide or restore a buyer review. Admins only.
 *
 * Hiding keeps the row and records who hid it and why. The public average
 * reads hiddenAt, so a hidden review drops out of it without being deleted.
 * Sellers cannot call this.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limit = rateLimiters.api(getClientIp(req));
  if (!limit.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit.resetTime)) } }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const body = payload && typeof payload === "object" ? (payload as { reviewId?: unknown; action?: unknown; reason?: unknown }) : {};
  const reviewId = typeof body.reviewId === "string" ? body.reviewId : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(reviewId)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (body.action !== "hide" && body.action !== "unhide") {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const reason = body.action === "hide" ? reviewReason(body.reason) : null;
  if (body.action === "hide" && !reason) return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    const review = await prisma.productReview.findUnique({ where: { id: reviewId }, select: { id: true } });
    if (!review) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await prisma.productReview.update({
      where: { id: review.id },
      data:
        body.action === "hide"
          ? { hiddenAt: new Date(), hiddenBy: session.user.email.toLowerCase(), hiddenReason: reason }
          : { hiddenAt: null, hiddenBy: null, hiddenReason: null },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Review moderation failed:", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "error" }, { status: 500 });
  }
}
