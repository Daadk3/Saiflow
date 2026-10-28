import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { runAfterResponse } from "@/lib/after-response";
import { notifyProductModerated } from "@/lib/notify";
import { SAFE_DELIVERABLE_WHERE, deliverableGateReason, isDeliverableSafe } from "@/lib/file-safety";

/** Approval refused inside the transaction: the file changed after the check. */
class NotApprovable extends Error {}

// POST - Record a moderation decision for a product (admins only).
// Body: { action: "APPROVED" | "REJECTED", reason?: string }
// Every decision is written to the append-only ModerationEvent audit log.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { productId } = await params;
    const { action, reason } = await req.json();

    if (action !== "APPROVED" && action !== "REJECTED") {
      return NextResponse.json(
        { error: "Action must be APPROVED or REJECTED" },
        { status: 400 }
      );
    }
    // Any reason sent must be text of reasonable length: it is stored in the
    // audit log and emailed to the seller as written.
    if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > 2000)) {
      return NextResponse.json({ error: "The reason must be text of at most 2,000 characters." }, { status: 400 });
    }
    if (action === "REJECTED" && (!reason || typeof reason !== "string" || !reason.trim())) {
      // Rejections without reasons are unappealable and unexplainable — refuse.
      return NextResponse.json(
        { error: "A reason is required when rejecting a product" },
        { status: 400 }
      );
    }

    const admin = await prisma.user.findFirst({
      where: { email: { equals: session.user.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!admin) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, moderationStatus: true, fileKey: true, fileScanStatus: true, fileScanKey: true },
    });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Approval means "fit to sell", and nothing is fit to sell without a
    // deliverable that passed its safety check. Approving a product with no
    // file, or one still scanning, failed or flagged, is refused with the
    // reason, so the review page can say why. Rejection needs no file.
    if (action === "APPROVED" && !isDeliverableSafe(product)) {
      return NextResponse.json(
        { error: "not_approvable", reason: deliverableGateReason(product) },
        { status: 409 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      let p: { id: string; moderationStatus: string };
      if (action === "APPROVED") {
        // The same gate again, as the write's own condition: a file replaced
        // or re-flagged after the check above makes this match nothing, and
        // the whole decision rolls back.
        const approved = await tx.product.updateMany({
          where: { id: productId, ...SAFE_DELIVERABLE_WHERE },
          data: { moderationStatus: "APPROVED" },
        });
        if (approved.count !== 1) throw new NotApprovable();
        p = { id: productId, moderationStatus: "APPROVED" };
      } else {
        p = await tx.product.update({
          where: { id: productId },
          data: { moderationStatus: action },
        });
      }
      await tx.moderationEvent.create({
        data: {
          productId,
          action,
          actor: `admin:${admin.id}`,
          reason: reason?.trim() || null,
          previousStatus: product.moderationStatus,
          newStatus: action,
        },
      });
      return p;
    });

    // Tell the seller, after the decision and its audit row are committed
    // and after the response. The email carries the stored reason; it can
    // neither change the decision nor delay the reply.
    await runAfterResponse(() =>
      notifyProductModerated({ productId, action, reason: reason?.trim() || null })
    );

    return NextResponse.json({
      id: updated.id,
      moderationStatus: updated.moderationStatus,
    });
  } catch (error) {
    if (error instanceof NotApprovable) {
      return NextResponse.json({ error: "not_approvable", reason: "file_changed" }, { status: 409 });
    }
    console.error("Error recording moderation decision:", (error as Error)?.name ?? "Error", (error as { code?: unknown })?.code ?? "");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
