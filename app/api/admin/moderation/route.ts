import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";

// GET - Pending moderation queue (admins only)
export async function GET(req: Request) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const pending = await prisma.product.findMany({
      where: { moderationStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        currency: true,
        category: true,
        thumbnailUrl: true,
        // The deliverable's own URL is deliberately NOT selected. Since Stage B
        // it is a private object that no browser can open, and the queue now
        // inspects through /api/admin/inspect/[productId] instead. `fileKey` is
        // read only to decide whether that link can work at all.
        fileKey: true,
        certifiedAt: true,
        createdAt: true,
        shop: { select: { name: true, slug: true } },
      },
    });

    // Emit a boolean, never a key and never a URL: the client needs to know
    // only whether to render the inspect link.
    return NextResponse.json({
      pending: pending.map(({ fileKey, ...rest }) => ({
        ...rest,
        canInspect: fileKey != null,
      })),
    });
  } catch (error) {
    console.error("Error fetching moderation queue:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
