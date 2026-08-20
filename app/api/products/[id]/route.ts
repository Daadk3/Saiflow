import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { isProductCategory } from "@/lib/categories";
import {
  isAllowedAssetUrl,
  extractAssetKey,
  extractOwnAssetKey,
} from "@/lib/validations";
import {
  verifyDeliverableProvenance,
  attachedScanFields,
  reconcileProductScanState,
} from "@/lib/file-safety";

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
     * The deliverable is validated below, once the stored row is available —
     * see the note there for why that ordering is required.
     */
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

    /**
     * Deliverable validation, deliberately placed after the row is loaded and
     * ownership is proven.
     *
     * A NEW deliverable must sit on SaiFlow's own UploadThing app, so a shop
     * member cannot point a product at a file uploaded to a personal account
     * and bypass the type and size allowlist.
     *
     * An UNCHANGED value is exempt, and that exemption is load-bearing rather
     * than a convenience: the edit form preloads the stored URL into its state
     * and echoes it back on every save. Enforcing the strict host on an
     * unchanged value would make the products still hosted on the legacy shared
     * `utfs.io` domain permanently uneditable.
     */
    const submittedFileUrl = fileUrl === undefined ? undefined : fileUrl || null;
    const fileUrlChanged =
      submittedFileUrl !== undefined && submittedFileUrl !== product.fileUrl;

    let nextFileKey: string | null | undefined;
    if (submittedFileUrl !== undefined) {
      if (!fileUrlChanged) {
        // Same file as before. Derive the key with the permissive reader so a
        // legacy row backfills its key instead of being rejected.
        nextFileKey = product.fileKey ?? extractAssetKey(product.fileUrl);
      } else if (submittedFileUrl === null) {
        nextFileKey = null;
      } else {
        nextFileKey = extractOwnAssetKey(submittedFileUrl);
        if (!nextFileKey) {
          return NextResponse.json({ error: "Invalid file URL" }, { status: 400 });
        }
      }
    }

    /**
     * Provenance for a REPLACEMENT deliverable.
     *
     * Host pinning proved the new key is SaiFlow's; this proves it was
     * uploaded through the product-file route for THIS product's shop. Without
     * it, a seller who learned another shop's key could attach it here.
     *
     * The scan record that follows comes from the file's own FileAsset row
     * rather than being assumed: normally PENDING_SCAN, but already SAFE if the
     * worker settled it between upload and save.
     */
    let replacementScanFields: Record<string, unknown> | null = null;
    if (fileUrlChanged) {
      if (nextFileKey) {
        const provenance = await verifyDeliverableProvenance(
          nextFileKey,
          product.shopId
        );
        if (!provenance.ok) {
          return NextResponse.json(
            { error: "This file cannot be attached to a product." },
            { status: 400 }
          );
        }
        replacementScanFields = attachedScanFields(provenance.asset);
      } else {
        // File removed: clear the record so nothing survives pointing at it.
        replacementScanFields = {
          fileScanStatus: "PENDING_SCAN" as const,
          fileScanKey: null,
          fileScanSha256: null,
          fileScanAt: null,
          fileScanAttempts: 0,
        };
      }
    }

    /**
     * THE SLUG IS FROZEN AT CREATION AND IS NEVER REWRITTEN HERE.
     *
     * It used to be regenerated whenever the name changed, which quietly
     * destroyed every link a creator had already shared: the product URL is
     * `/shop/{shopSlug}/product/{productSlug}`, nothing redirects from the old
     * handle, and the public page turns a miss into notFound(). A creator who
     * posted to TikTok and later fixed a typo in the title killed the post,
     * with no warning and no way to recover the address.
     *
     * It was worse in Arabic, the primary market. `slugBase` strips non-Latin
     * characters to an empty string, so `slugify` returns `product-<random>` —
     * meaning a rename swapped the URL for an entirely unrelated new handle.
     *
     * The column is simply absent from the update below; Prisma leaves a
     * column it is not given alone, so no slug in the database ever changes
     * and every URL that works today keeps working.
     *
     * The cost is cosmetic and deliberate: a renamed product keeps its
     * original handle, so the URL can read stale next to the title. A
     * permanent address is worth more than a tidy one — Gumroad and Etsy make
     * the same trade. If a renamed URL ever has to follow the title, that
     * needs slug history plus 301s, which is a different and much larger
     * change than this one.
     *
     * Creation is untouched: `POST /api/products` still calls `slugify`, and
     * the `(shopId, slug)` unique constraint still applies there.
     */

    /**
     * A replaced deliverable must not inherit the previous file's verdict.
     *
     * Every upload mints a new storage key, so a key change is what detects the
     * replacement, and the scan record is rewritten from the NEW file's own
     * provenance row. This is belt-and-braces rather than the primary defence:
     * the safety predicate also requires fileScanKey == fileKey, so even if
     * this were removed a stale SAFE still could not authorise anything.
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
        description: description !== undefined ? description : product.description,
        price: price !== undefined ? price : product.price,
        category: category !== undefined ? (category || null) : product.category,
        fileUrl: fileUrl !== undefined ? fileUrl || null : product.fileUrl,
        thumbnailUrl:
          thumbnailUrl !== undefined ? thumbnailUrl || null : product.thumbnailUrl,
        ...(nextFileKey !== undefined ? { fileKey: nextFileKey } : {}),
        ...(fileChanged && replacementScanFields ? replacementScanFields : {}),
      },
    });

    // Same race as on create: the worker may have settled the new file
    // between the provenance read and this write.
    if (fileChanged && nextFileKey) {
      try {
        await reconcileProductScanState(updatedProduct.id, nextFileKey);
      } catch (error) {
        console.error("[scan] reconcile after edit failed", (error as Error)?.name);
      }
    }

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

