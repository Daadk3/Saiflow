import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";

// GET - Pending moderation queue (admins only)
export async function GET() {
  try {
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
        fileUrl: true,
        certifiedAt: true,
        createdAt: true,
        shop: { select: { name: true, slug: true } },
      },
    });

    return NextResponse.json({ pending });
  } catch (error) {
    console.error("Error fetching moderation queue:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
