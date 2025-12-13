import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/[...nextauth]/route";

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

    // Create new slug if name changed
    let newSlug = shop.slug;
    if (name && name !== shop.name) {
      newSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
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
    console.error("Error updating shop:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}