import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { getClientIp, rateLimiters } from "@/lib/rate-limit";

/**
 * Turn one store's sales on or off. Founder only (isAdminEmail / ADMIN_EMAILS).
 *
 * This does not approve, reject, or edit any product. A store with sales on
 * still sells only products that already pass the storefront rule.
 * A change is written to ShopSalesEvent in the same transaction as the
 * column, the same append-only idea as ModerationEvent. Setting the switch
 * to the value it already has writes nothing.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ shopId: string }> },
) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { shopId } = await params;
    if (!shopId || shopId.length > 64) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const enabled = body?.enabled;
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
    }

    const admin = await prisma.user.findFirst({
      where: { email: { equals: session.user.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!admin) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const shop = await tx.shop.findUnique({
        where: { id: shopId },
        select: { id: true, salesEnabled: true },
      });
      if (!shop) return null;
      if (shop.salesEnabled === enabled) return { salesEnabled: shop.salesEnabled, changed: false };

      const flipped = await tx.shop.updateMany({
        where: { id: shopId, salesEnabled: shop.salesEnabled },
        data: { salesEnabled: enabled },
      });
      if (flipped.count !== 1) {
        const again = await tx.shop.findUnique({
          where: { id: shopId },
          select: { salesEnabled: true },
        });
        return { salesEnabled: again?.salesEnabled ?? enabled, changed: false };
      }
      await tx.shopSalesEvent.create({
        data: { shopId, actor: `admin:${admin.id}`, enabled },
      });
      return { salesEnabled: enabled, changed: true };
    });

    if (!result) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error updating store sales:", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
