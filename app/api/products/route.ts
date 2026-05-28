import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../auth/authOptions";

// POST - Create a new product
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { name, description, price, category, shopId, fileUrl, thumbnailUrl, currency } = await req.json();

    if (!name || !price || !shopId) {
      return NextResponse.json(
        { error: "Name, price, and shopId are required" },
        { status: 400 }
      );
    }

    // Saudi-first marketplace: only SAR is supported. Reject any
    // explicit non-SAR currency loudly so future multi-currency
    // attempts fail visibly instead of silently writing USD again.
    const ALLOWED_CURRENCIES = ["SAR"];
    if (currency && !ALLOWED_CURRENCIES.includes(currency)) {
      return NextResponse.json(
        { error: "Invalid currency" },
        { status: 400 }
      );
    }

    // Get the user
    const user = await prisma.user.findFirst({
      where: { email: { equals: session.user.email, mode: "insensitive" } },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Verify user owns this shop
    const shopUser = await prisma.shopUser.findFirst({
      where: {
        userId: user.id,
        shopId: shopId,
      },
    });

    if (!shopUser) {
      return NextResponse.json(
        { error: "You don't have access to this shop" },
        { status: 403 }
      );
    }

    // Create slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    // Create the product
    const product = await prisma.product.create({
      data: {
        name,
        slug,
        description,
        price,
        category: category || null,
        shopId,
        fileUrl,
        thumbnailUrl,
        currency: "SAR",
      },
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error("Error creating product:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}