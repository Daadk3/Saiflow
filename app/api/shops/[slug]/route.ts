import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { slugify } from "@/lib/slug";
import { isAllowedAssetUrl } from "@/lib/validations";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { slug } = await params;

    const shop = await prisma.shop.findUnique({
      where: { slug },
      include: {
        products: true,
        shopUsers: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!shop) {
      return NextResponse.json(
        { error: "Shop not found" },
        { status: 404 }
      );
    }

    // Check if user has access to this shop
    const userHasAccess = shop.shopUsers.some(
      (su) => su.user.email === session.user?.email
    );

    if (!userHasAccess) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    return NextResponse.json(shop);
  } catch (error) {
    console.error("Error fetching shop:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

// PUT - Update shop details
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { slug } = await params;
    const { name, description, logo, coverImage } = await req.json();

    // Bounds + asset-URL validation (same rules as shop/product creation)
    if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.length > 100)) {
      return NextResponse.json(
        { error: "Shop name must be between 2 and 100 characters" },
        { status: 400 }
      );
    }
    if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 1000)) {
      return NextResponse.json(
        { error: "Description must be less than 1,000 characters" },
        { status: 400 }
      );
    }
    if (logo && !isAllowedAssetUrl(logo)) {
      return NextResponse.json({ error: "Invalid logo URL" }, { status: 400 });
    }
    if (coverImage && !isAllowedAssetUrl(coverImage)) {
      return NextResponse.json({ error: "Invalid cover image URL" }, { status: 400 });
    }

    // Get the shop and verify ownership
    const shop = await prisma.shop.findUnique({
      where: { slug },
      include: {
        shopUsers: {
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        },
      },
    });

    if (!shop) {
      return NextResponse.json(
        { error: "Shop not found" },
        { status: 404 }
      );
    }

    // Check if user has access to this shop
    const userHasAccess = shop.shopUsers.some(
      (su) => su.user.email === session.user?.email
    );

    if (!userHasAccess) {
      return NextResponse.json(
        { error: "You don't have permission to edit this shop" },
        { status: 403 }
      );
    }

    // Create new slug if name changed (falls back to a random handle for non-Latin names)
    let newSlug = shop.slug;
    if (name && name !== shop.name) {
      newSlug = slugify(name, "shop");
    }

    // Update the shop
    const updatedShop = await prisma.shop.update({
      where: { id: shop.id },
      data: {
        name: name || shop.name,
        slug: newSlug,
        description: description !== undefined ? description : shop.description,
        logo: logo !== undefined ? logo : shop.logo,
        coverImage: coverImage !== undefined ? coverImage : shop.coverImage,
      },
    });

    return NextResponse.json(updatedShop);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A shop with this name already exists" },
        { status: 400 }
      );
    }
    console.error("Error updating shop:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}