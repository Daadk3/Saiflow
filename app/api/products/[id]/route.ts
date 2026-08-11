import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { slugify } from "@/lib/slug";
import { isProductCategory } from "@/lib/categories";
import { isAllowedAssetUrl, extractAssetKey } from "@/lib/validations";

// GET - Get a single product by ID (seller dashboard only)
// SECURITY: this returns the full row including fileUrl (the paid asset),
// so it must be restricted to authenticated members of the owning shop.
// Public product data is served by the server-rendered product page instead.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            slug: true,
            shopUsers: {
              select: { user: { select: { email: true } } },
            },
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    const email = session.user.email.toLowerCase();
    const isMember = product.shop.shopUsers.some(
      (su) => su.user.email.toLowerCase() === email
    );
    if (!isMember) {
      return NextResponse.json(
        { error: "You don't have access to this product" },
        { status: 403 }
      );
    }

    // Don't leak the member list in the response
    const shop = { id: product.shop.id, name: product.shop.name, slug: product.shop.slug };
    return NextResponse.json({ ...product, shop });
  } catch (error) {
    console.error("Error fetching product:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

// PUT - Update a product
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const { name, description, price, category, fileUrl, thumbnailUrl } = await req.json();

    if (category && !isProductCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    /**
     * Asset URLs were previously written straight through on this route, while
     * the create route validated them. That gap let a shop member store an
     * arbitrary URL, which downstream code trusts: the download route redirects
     * to it, and checkout fetches it server-side.
     *
     * Both are validated here now, and the deliverable's key is derived rather
     * than trusted, exactly as on create.
     */
    let nextFileKey: string | null | undefined;
    if (fileUrl !== undefined) {
      if (fileUrl === null || fileUrl === "") {
        nextFileKey = null;
      } else {
        nextFileKey = extractAssetKey(fileUrl);
        if (!nextFileKey) {
          return NextResponse.json({ error: "Invalid file URL" }, { status: 400 });
        }
      }
    }
    if (
      thumbnailUrl !== undefined &&
      thumbnailUrl !== null &&
      thumbnailUrl !== "" &&
      !isAllowedAssetUrl(thumbnailUrl)
    ) {
      return NextResponse.json({ error: "Invalid thumbnail URL" }, { status: 400 });
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

    // Get the product and verify ownership
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        shop: {
          include: {
            shopUsers: {
              where: { userId: user.id },
            },
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Check if user has access to this shop
    if (product.shop.shopUsers.length === 0) {
      return NextResponse.json(
        { error: "You don't have permission to edit this product" },
        { status: 403 }
      );
    }

    // Create new slug if name changed (falls back to a random handle for non-Latin names)
    let slug = product.slug;
    if (name && name !== product.name) {
      slug = slugify(name, "product");
    }

    /**
     * A replaced deliverable must not inherit the previous file's verdict.
     *
     * Every upload mints a new storage key, so comparing keys detects the
     * replacement, and the whole scan record is cleared back to PENDING_SCAN.
     * This is belt-and-braces rather than the primary defence: the safety
     * predicate also requires fileScanKey == fileKey, so even if this reset
     * were removed the stale SAFE still could not authorise anything.
     *
     * Legacy rows carry a fileUrl but no fileKey, so re-saving one backfills
     * its key and leaves it — correctly — unscanned.
     */
    const fileChanged =
      nextFileKey !== undefined && nextFileKey !== product.fileKey;

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        name: name || product.name,
        slug,
        description: description !== undefined ? description : product.description,
        price: price !== undefined ? price : product.price,
        category: category !== undefined ? (category || null) : product.category,
        fileUrl: fileUrl !== undefined ? fileUrl || null : product.fileUrl,
        thumbnailUrl:
          thumbnailUrl !== undefined ? thumbnailUrl || null : product.thumbnailUrl,
        ...(nextFileKey !== undefined ? { fileKey: nextFileKey } : {}),
        ...(fileChanged
          ? {
              fileScanStatus: "PENDING_SCAN" as const,
              fileScanKey: null,
              fileScanSha256: null,
              fileScanAt: null,
              fileScanAttempts: 0,
            }
          : {}),
      },
    });

    return NextResponse.json(updatedProduct);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A product with a similar name already exists in this shop. Try a different name." },
        { status: 400 }
      );
    }
    console.error("Error updating product:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a product
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;

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

    // Get the product and verify ownership
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        shop: {
          include: {
            shopUsers: {
              where: { userId: user.id },
            },
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Check if user has access to this shop
    if (product.shop.shopUsers.length === 0) {
      return NextResponse.json(
        { error: "You don't have permission to delete this product" },
        { status: 403 }
      );
    }

    // Delete the product
    await prisma.product.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

