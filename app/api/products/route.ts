import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../auth/authOptions";
import { slugify } from "@/lib/slug";
import { isAllowedAssetUrl } from "@/lib/validations";
import { isProductCategory } from "@/lib/categories";

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

    const { name, description, price, category, shopId, fileUrl, thumbnailUrl, currency, certified } = await req.json();

    // Trust & Safety: the seller must explicitly certify ownership, legality
    // under Saudi regulations, and responsibility before every upload.
    if (certified !== true) {
      return NextResponse.json(
        { error: "You must accept the seller certification to publish a product." },
        { status: 400 }
      );
    }

    if (!name || price === undefined || price === null || !shopId) {
      return NextResponse.json(
        { error: "Name, price, and shopId are required" },
        { status: 400 }
      );
    }

    // Bounds validation
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 200) {
      return NextResponse.json(
        { error: "Product name must be between 2 and 200 characters" },
        { status: 400 }
      );
    }
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0 || numericPrice > 100000) {
      return NextResponse.json(
        { error: "Price must be between 0 and 100,000 SAR" },
        { status: 400 }
      );
    }
    if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 10000)) {
      return NextResponse.json(
        { error: "Description must be less than 10,000 characters" },
        { status: 400 }
      );
    }
    if (fileUrl && !isAllowedAssetUrl(fileUrl)) {
      return NextResponse.json(
        { error: "Invalid file URL" },
        { status: 400 }
      );
    }
    if (thumbnailUrl && !isAllowedAssetUrl(thumbnailUrl)) {
      return NextResponse.json(
        { error: "Invalid thumbnail URL" },
        { status: 400 }
      );
    }
    // Category must come from the shared taxonomy (lib/categories.ts). An
    // unconstrained value would leave the product live but invisible to every
    // browse filter.
    if (category && !isProductCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
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

    // Create slug from name (falls back to a random handle for non-Latin names)
    const slug = slugify(name, "product");

    // Create the product (PENDING by default) + its audit-trail entry
    // atomically: certification without an audit event would be unprovable.
    const now = new Date();
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: name.trim(),
          slug,
          description,
          price: numericPrice,
          category: category || null,
          shopId,
          fileUrl,
          thumbnailUrl,
          currency: "SAR",
          certifiedAt: now,
          // moderationStatus defaults to PENDING via schema
        },
      });
      await tx.moderationEvent.create({
        data: {
          productId: created.id,
          action: "SUBMITTED",
          actor: `seller:${user.id}`,
          reason: "Seller certified ownership, legality, and responsibility at upload.",
          previousStatus: null, // product creation — no prior state
          newStatus: "PENDING",
        },
      });
      return created;
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    // Unique-constraint race on (shopId, slug): return a friendly error, not a 500
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A product with a similar name already exists in this shop. Try a different name." },
        { status: 400 }
      );
    }
    console.error("Error creating product:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}