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
import { scheduleScan } from "@/lib/scan/schedule";
import { IMAGE_NOT_ALLOWED, verifyImageProvenance } from "@/lib/image-provenance";
import { FILE_REQUIRED } from "@/lib/product-file-required";
import { announceReadyAtAttach } from "@/lib/scan/announce";
import { redactId } from "@/lib/redact-id";
import { priceProblemMessage, validatePrice } from "@/lib/pricing";

// A replacement file schedules its scan to run after the response is sent;
// see app/api/products/route.ts for why this route carries the worker's budget.
export const maxDuration = 300;

/**
 * The database refused a product delete because an Order or a PaymentSession
 * still names it (ON DELETE RESTRICT). Prisma reports a foreign-key
 * violation as P2003, and a required relation it would break as P2014.
 */
function isRestrictedByPaymentRecords(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "P2003" || code === "P2014";
}

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

    // Only what the edit page shows: never the storage key, scan hashes or
    // scan bookkeeping, which the browser has no use for.
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        price: true,
        currency: true,
        category: true,
        fileUrl: true,
        thumbnailUrl: true,
        moderationStatus: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        shopId: true,
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
    // Why it was rejected, for the edit page: the seller's own product.
    const rejection =
      product.moderationStatus === "REJECTED"
        ? await prisma.moderationEvent.findFirst({
            where: { productId: product.id, action: "REJECTED" },
            orderBy: { createdAt: "desc" },
            select: { reason: true },
          })
        : null;
    return NextResponse.json({ ...product, shop, rejectionReason: rejection?.reason?.trim() || null });
  } catch (error) {
    console.error("Error fetching product:", (error as Error)?.name ?? "Error", (error as { code?: unknown })?.code ?? "");
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

    // The same bounds as on create (app/api/products POST): an edit must not
    // be the way around them.
    if (name !== undefined && name !== null && name !== "" && (typeof name !== "string" || name.trim().length < 2 || name.length > 200)) {
      return NextResponse.json({ error: "Product name must be between 2 and 200 characters" }, { status: 400 });
    }
    if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 10000)) {
      return NextResponse.json({ error: "Description must be less than 10,000 characters" }, { status: 400 });
    }
    if (fileUrl !== undefined && fileUrl !== null && typeof fileUrl !== "string") {
      return NextResponse.json({ error: "Invalid file URL" }, { status: 400 });
    }
    if (thumbnailUrl !== undefined && thumbnailUrl !== null && typeof thumbnailUrl !== "string") {
      return NextResponse.json({ error: "Invalid thumbnail URL" }, { status: 400 });
    }

    if (category && !isProductCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    // A submitted price goes through the same validator as on create. This
    // route used to write whatever it was sent, so a negative, oversized or
    // three-decimal price could reach the row here and nowhere else.
    let nextPrice: string | undefined;
    if (price !== undefined) {
      const priceCheck = validatePrice(price);
      if (!priceCheck.ok) {
        return NextResponse.json({ error: priceProblemMessage(priceCheck.reason) }, { status: 400 });
      }
      nextPrice = priceCheck.price;
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
        // legacy row backfills its key instead of being rejected, but only
        // when that key is this shop's own upload: an old row could point at
        // another shop's file, and backfilling it would make that file this
        // product's deliverable. Otherwise the seller re-uploads.
        if (product.fileKey) {
          nextFileKey = product.fileKey;
        } else {
          const legacyKey = extractAssetKey(product.fileUrl);
          const owned = legacyKey ? await verifyDeliverableProvenance(legacyKey, product.shopId) : null;
          nextFileKey = owned?.ok ? legacyKey : null;
        }
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
    // A product cannot be saved without its deliverable: removing the file, or
    // editing a product that never had one, is refused until a file is
    // uploaded (lib/product-file-required). An older product with no file
    // is resubmitted by uploading one.
    const resultingFileKey = nextFileKey !== undefined ? nextFileKey : product.fileKey;
    if (!resultingFileKey) {
      return NextResponse.json(FILE_REQUIRED, { status: 400 });
    }

    // A NEW thumbnail must be this shop's own upload (lib/image-provenance).
    // An unchanged one passes: it may predate upload records.
    if (thumbnailUrl && thumbnailUrl !== product.thumbnailUrl) {
      const image = await verifyImageProvenance(thumbnailUrl, product.shopId, "PRODUCT_THUMBNAIL");
      if (!image.ok) return NextResponse.json(IMAGE_NOT_ALLOWED, { status: 400 });
    }

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

    const nextName = name || product.name;
    const nextDescription = description !== undefined ? description : product.description;
    const nextThumbnail = thumbnailUrl !== undefined ? thumbnailUrl || null : product.thumbnailUrl;

    /**
     * Back to review, decided BEFORE anything is written and written in the
     * same transaction as the edit, so a product is never live, even briefly,
     * with content no one has approved.
     *
     * - REJECTED: any edit resubmits it (the rejection email asks for one),
     *   except in a suspended shop, whose rejections stand until an admin
     *   restores it.
     * - APPROVED: an approval was a decision about what was looked at, so
     *   replacing the file or changing what a buyer reads or sees (name,
     *   description, picture) sends it back. Price and category do not. This
     *   applies in a suspended shop too, so restoring the shop never revives
     *   an unreviewed listing.
     *
     * The write matches only while the product still has the status this
     * request read: an admin's decision made at the same moment is never
     * overwritten (the seller is asked to reload instead).
     */
    const listingChanged =
      nextName !== product.name ||
      // "" and null are the same empty description: the edit form sends ""
      // for a product saved without one.
      (nextDescription ?? "") !== (product.description ?? "") ||
      nextThumbnail !== product.thumbnailUrl;
    const reopenFrom =
      product.moderationStatus === "APPROVED" && (fileChanged || listingChanged)
        ? ("APPROVED" as const)
        : product.moderationStatus === "REJECTED" && product.shop.isActive
          ? ("REJECTED" as const)
          : null;

    let updatedProduct;
    // One write; a transaction only when its moderation log entry goes with it.
    const save = async (tx: Prisma.TransactionClient | typeof prisma) => {
        const written = await tx.product.update({
          where: { id, moderationStatus: product.moderationStatus },
          data: {
            name: nextName,
            description: nextDescription,
            price: nextPrice !== undefined ? nextPrice : product.price,
            category: category !== undefined ? (category || null) : product.category,
            fileUrl: fileUrl !== undefined ? fileUrl || null : product.fileUrl,
            thumbnailUrl: nextThumbnail,
            ...(nextFileKey !== undefined ? { fileKey: nextFileKey } : {}),
            ...(fileChanged && replacementScanFields ? replacementScanFields : {}),
            ...(reopenFrom ? { moderationStatus: "PENDING" as const } : {}),
          },
        });
        if (reopenFrom) {
          await tx.moderationEvent.create({
            data: {
              productId: id,
              action: "RESUBMITTED",
              actor: `seller:${user.id}`,
              reason:
                reopenFrom === "APPROVED"
                  ? fileUrlChanged
                    ? "File replaced after approval"
                    : "Listing edited after approval"
                  : null,
              previousStatus: reopenFrom,
              newStatus: "PENDING",
            },
          });
        }
        return written;
    };
    try {
      updatedProduct = reopenFrom ? await prisma.$transaction((tx) => save(tx)) : await save(prisma);
    } catch (error) {
      // P2025: no row matched id AND the status read above, i.e. an admin
      // decided while this edit was saving.
      if ((error as { code?: unknown } | null)?.code === "P2025") {
        return NextResponse.json(
          { error: "This product's review status changed while you were editing. Reload the page and try again." },
          { status: 409 }
        );
      }
      throw error;
    }
    const resubmitted = reopenFrom !== null;
    if (resubmitted) {
      console.log(`[moderation] resubmitted product=${redactId(id)} by=seller`);
    }

    // Same race as on create: the worker may have settled the new file
    // between the provenance read and this write. One announcement covers a
    // replaced file and a resubmission alike: the row was written PENDING
    // in the same step when it went back to review.
    if ((fileChanged && nextFileKey) || resubmitted) {
      try {
        await announceReadyAtAttach(updatedProduct);
      } catch (error) {
        console.error("[notify] announce after edit failed", (error as Error)?.name);
      }
    }
    if (fileChanged && nextFileKey) {
      try {
        await reconcileProductScanState(updatedProduct.id, nextFileKey);
      } catch (error) {
        console.error("[scan] reconcile after edit failed", (error as Error)?.name);
      }
      // The file changed: scan the new bytes now rather than at the next sweep.
      scheduleScan(nextFileKey);
    }

    return NextResponse.json(updatedProduct);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A product with a similar name already exists in this shop. Try a different name." },
        { status: 400 }
      );
    }
    console.error("Error updating product:", (error as Error)?.name ?? "Error", (error as { code?: unknown })?.code ?? "");
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

    // Delete the product. The database decides whether it may go: Order and
    // PaymentSession refer to it with ON DELETE RESTRICT, so a product with
    // any purchase or payment attempt is refused there, atomically, even if a
    // checkout starts at this very moment. No count is taken here first: a
    // check made before the delete could be stale by the time it runs.
    try {
      await prisma.product.delete({
        where: { id },
      });
    } catch (error) {
      if (isRestrictedByPaymentRecords(error)) {
        return NextResponse.json(
          {
            error: "has_payment_records",
            message: "This product has sales or payment records, so it can't be deleted.",
          },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", (error as Error)?.name ?? "Error", (error as { code?: unknown })?.code ?? "");
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

