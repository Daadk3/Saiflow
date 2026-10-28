import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../auth/authOptions";
import { slugify } from "@/lib/slug";
import { accountKey, rateLimiters, retryAfterSeconds } from "@/lib/rate-limit";
import { runAfterResponse } from "@/lib/after-response";
import { notifyAdminsStoreCreated } from "@/lib/notify";
import { sessionUserId } from "@/lib/session-account";
import { parseNewStoreLocation } from "@/lib/store-location";

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

    // One account cannot open stores faster than the founder can read about
    // them: 3 an hour, decided before any lookup, write or email, keyed by
    // the account rather than the address, and answered with a fixed body.
    const limit = rateLimiters.createShop(accountKey(session.user.email));
    if (!limit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit.resetTime)) } }
      );
    }

    const body = await req.json();
    const { name, description } = body ?? {};

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
    // Country is required. City is optional. Existing shops are untouched:
    // this only runs when a store is opened.
    const location = parseNewStoreLocation({
      country: body?.country,
      city: body?.city,
    });
    if (!location.ok) {
      return NextResponse.json({ error: location.error }, { status: 400 });
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
        country: location.country,
        city: location.city,
        shopUsers: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    // Tell the founder, after the row exists and after the response: the
    // notifier never throws, and nothing here can undo the shop.
    await runAfterResponse(() =>
      notifyAdminsStoreCreated({
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        country: shop.country,
        city: shop.city,
        creatorName: user.name?.trim() || null,
      })
    );

    return NextResponse.json(shop, { status: 201 });
  } catch (error) {
    // Unique-slug race: return a friendly error, not a 500
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A shop with this name already exists" },
        { status: 400 }
      );
    }
    console.error("Error creating shop:", (error as Error)?.name ?? "Error", (error as { code?: unknown })?.code ?? "");
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

    // By account id (lib/session-account): exactly the signed-in account.
    const userId = sessionUserId(session);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
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
    console.error("Error fetching shops:", (error as Error)?.name ?? "Error", (error as { code?: unknown })?.code ?? "");
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}