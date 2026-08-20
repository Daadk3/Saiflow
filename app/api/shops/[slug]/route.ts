import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { isAllowedAssetUrl } from "@/lib/validations";
import { creatorFileStatus } from "@/lib/creator-file-status";

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

    // Selected, not included. `products: true` returned whole rows, so every
    // scan column — fileKey, fileScanKey, fileScanSha256, fileScanAttempts —
    // plus the deliverable URL travelled to the seller's browser, where none
    // of it was used. Authorised over-disclosure is still disclosure, and a
    // payload is the easiest place for a later reader to start treating a
    // client value as a safety fact.
    //
    // The scan columns ARE read here, on the server, to derive the coarse
    // creator status below. They are dropped before the response is built.
    const shop = await prisma.shop.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logo: true,
        coverImage: true,
        createdAt: true,
        products: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            price: true,
            currency: true,
            thumbnailUrl: true,
            moderationStatus: true,
            createdAt: true,
            // Server-side only — see the map below. fileUrl is deliberately
            // NOT selected: nothing reads it now that hasFile keys on fileKey,
            // and a deliverable URL sitting unused in a query is how it ends
            // up back in a payload.
            fileKey: true,
            fileScanStatus: true,
            fileScanKey: true,
          },
        },
        // Membership, for the authorisation check only. Emails are compared
        // here and never returned: the dashboard does not use shopUsers, and
        // shipping co-members' addresses to the browser is disclosure without
        // a purpose.
        shopUsers: {
          select: { user: { select: { email: true } } },
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

    // Shape the response deliberately rather than spreading the row. Every
    // field below is one the dashboard renders; the scan columns are consumed
    // by creatorFileStatus and then discarded.
    const { shopUsers: _members, products, ...shopFields } = shop;
    void _members;

    return NextResponse.json({
      ...shopFields,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: p.price,
        currency: p.currency,
        thumbnailUrl: p.thumbnailUrl,
        moderationStatus: p.moderationStatus,
        createdAt: p.createdAt,
        // A boolean, not the URL — the deliverable URL is not the browser's
        // business, and the dashboard only ever asked "is there a file?".
        //
        // Keyed on fileKey, NOT fileUrl. The legacy rows carry a fileUrl with
        // no fileKey, so reading fileUrl answered "was there once a file?"
        // rather than "is one attached now". Those are exactly the products E2
        // refuses to sell, and the boolean was suppressing the dashboard's
        // "upload a file" warning on every one of them — hiding the prompt
        // from the only creators who needed it.
        //
        // fileKey is the column every gate reads, so this now agrees with them.
        hasFile: p.fileKey !== null,
        // Derived here, from the same columns the gates read, by the same
        // reviewed vocabulary. The browser renders this string; it cannot
        // compute it, contradict it, or send one back.
        fileSafety: creatorFileStatus(p),
      })),
    });
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

    /**
     * THE SHOP SLUG IS FROZEN AT CREATION AND IS NEVER REWRITTEN HERE.
     *
     * This one is the more damaging of the two. The shop slug is the FIRST
     * segment of every product URL in the shop —
     * `/shop/{shopSlug}/product/{productSlug}` — so regenerating it on a
     * rename broke not one link but every link the shop had ever shared, all
     * at once, including the storefront's own address.
     *
     * The column is absent from the update below. Prisma leaves a column it is
     * not given alone, so no slug changes and every URL that works today keeps
     * working. The route is addressed by slug (`/api/shops/[slug]`), so
     * freezing also means a shop's own API path stays stable across renames.
     *
     * Creation is untouched: `POST /api/shops` still calls `slugify`.
     */

    // Update the shop
    const updatedShop = await prisma.shop.update({
      where: { id: shop.id },
      data: {
        name: name || shop.name,
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