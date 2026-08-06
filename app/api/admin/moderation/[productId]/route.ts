import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";

// POST - Record a moderation decision for a product (admins only).
// Body: { action: "APPROVED" | "REJECTED", reason?: string }
// Every decision is written to the append-only ModerationEvent audit log.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
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
      select: { id: true, moderationStatus: true },
    });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.product.update({
        where: { id: productId },
        data: { moderationStatus: action },
      });
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

    return NextResponse.json({
      id: updated.id,
      moderationStatus: updated.moderationStatus,
    });
  } catch (error) {
    console.error("Error recording moderation decision:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
