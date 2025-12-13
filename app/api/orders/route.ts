import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../auth/[...nextauth]/route";

// GET - Get orders for user's shops
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get the user and their shops
    const user = await prisma.user.findFirst({
      where: { email: { equals: session.user.email, mode: "insensitive" } },
      include: {
        shopUsers: {
          include: {
            shop: {
              include: {
                products: {
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Get all product IDs from user's shops
    const productIds = user.shopUsers.flatMap((su) =>
      su.shop.products.map((p) => p.id)
    );

    // Get orders for these products
    const orders = await prisma.order.findMany({
      where: {
        productId: { in: productIds },
      },
      include: {
        product: {
          include: {
            shop: {
              select: {
                name: true,
                slug: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate totals
    const totalRevenue = orders.reduce(
      (sum, order) => sum + Number(order.price),
      0
    );
    const totalSales = orders.length;

    return NextResponse.json({
      orders,
      totalRevenue,
      totalSales,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

