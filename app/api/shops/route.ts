import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../auth/authOptions";
import { slugify } from "@/lib/slug";

// POST - Create a new shop
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { name, description } = await req.json();

    if (!name || typeof name !== "string" || name.trim().length < 2 || name.length > 100) {
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

    // Create slug from name (falls back to a random handle for non-Latin names)
    const slug = slugify(name, "shop");

    // Check if slug already exists
    const existingShop = await prisma.shop.findUnique({
      where: { slug },
    });

    if (existingShop) {
      return NextResponse.json(
        { error: "A shop with this name already exists" },
        { status: 400 }
      );
    }

    // Create shop and connect user as owner
    const shop = await prisma.shop.create({
      data: {
        name,
        slug,
        description,
        shopUsers: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    return NextResponse.json(shop, { status: 201 });
  } catch (error) {
    // Unique-slug race: return a friendly error, not a 500
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A shop with this name already exists" },
        { status: 400 }
      );
    }
    console.error("Error creating shop:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

// GET - Get user's shops
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        shopUsers: {
          include: {
            shop: {
              include: {
                _count: {
                  select: { products: true },
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

    const shops = user.shopUsers.map((su) => ({
      ...su.shop,
      role: su.role,
    }));

    return NextResponse.json(shops);
  } catch (error) {
    console.error("Error fetching shops:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}