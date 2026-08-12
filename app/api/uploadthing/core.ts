import { createUploadthing, type FileRouter } from "uploadthing/next";
import { getServerSession } from "next-auth";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import type { UploadRoute } from "@prisma/client";
import { authOptions } from "../auth/authOptions";
import { prisma } from "@/lib/prisma";
import {
  PRODUCT_FILE_CONFIG,
  PRODUCT_THUMBNAIL_CONFIG,
  SHOP_LOGO_CONFIG,
  SHOP_COVER_CONFIG,
} from "@/lib/upload-config";

const f = createUploadthing();

/**
 * Every upload route now names the shop it is uploading for.
 *
 * Authentication alone was never the right check: it proved only that
 * *somebody* was signed in, so any account could push objects into SaiFlow's
 * storage. Naming the shop lets the server verify the uploader may actually
 * publish to it.
 */
const shopScopedUpload = z.object({ shopId: z.string().min(1).max(64) });

/**
 * P0: the uploader must be an authenticated member of the shop they name.
 *
 * `shopId` arrives from the client and is therefore untrusted — it is used
 * only as a lookup key, and it is the membership row that authorises the
 * upload. Naming someone else's shop finds no membership and is rejected
 * before a single byte is stored.
 *
 * The three failure modes — no session, no such shop, not a member — are
 * deliberately indistinguishable, so this endpoint cannot be used to
 * enumerate shop ids.
 */
const requireShopMember = async ({ input }: { input: { shopId: string } }) => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new UploadThingError("Unauthorized");
  }

  const membership = await prisma.shopUser.findFirst({
    where: {
      shopId: input.shopId,
      user: { email: { equals: session.user.email, mode: "insensitive" } },
    },
    select: { userId: true },
  });

  if (!membership) {
    throw new UploadThingError("Unauthorized");
  }

  // Server-side metadata for onUploadComplete only. Carries no email, so no
  // PII crosses into the upload callback.
  return { userId: membership.userId, shopId: input.shopId };
};

/**
 * Record provenance for a completed upload.
 *
 * This is the only place a FileAsset is ever created, and every value it
 * stores is one the server already established: the key and size come from
 * UploadThing's own callback, the shop and uploader from middleware that
 * verified membership. Nothing here is taken from a request body, which is
 * what makes the record usable later as an authorisation source.
 *
 * Provenance ONLY — no scanning. The scan moves bytes twice and cannot fit in
 * this route's duration budget; the dedicated worker owns that.
 *
 * Idempotent by upsert: UploadThing may replay a callback, and a replay must
 * not reset a verdict the worker has already written.
 */
const recordProvenance =
  (route: UploadRoute) =>
  async ({
    file,
    metadata,
  }: {
    file: { key: string; name: string; size: number; type: string; ufsUrl: string };
    metadata: { userId: string; shopId: string };
  }) => {
    await prisma.fileAsset.upsert({
      where: { key: file.key },
      create: {
        key: file.key,
        shopId: metadata.shopId,
        route,
        uploadedById: metadata.userId,
        name: file.name,
        size: file.size,
        // Client-declared. Stored as a hint for triage; the scanner establishes
        // the real format from the bytes.
        declaredType: file.type,
      },
      update: {},
    });

    // Identifiers only. The URL is the (private) asset itself.
    console.log(
      `[upload] ${route} key=${file.key} shop=${metadata.shopId} size=${file.size}`
    );

    return { url: file.ufsUrl };
  };

// FileRouter for your app, can contain multiple FileRoutes
export const ourFileRouter = {
  // The seller's deliverable. PRIVATE — see lib/upload-config.ts. Completing
  // an upload no longer produces a readable URL for anyone; reads require a
  // short-lived signed URL minted server-side.
  productFile: f(PRODUCT_FILE_CONFIG)
    .input(shopScopedUpload)
    .middleware(requireShopMember)
    .onUploadComplete(recordProvenance("PRODUCT_FILE")),

  // Listing artwork. Public by design — see lib/upload-config.ts.
  productThumbnail: f(PRODUCT_THUMBNAIL_CONFIG)
    .input(shopScopedUpload)
    .middleware(requireShopMember)
    .onUploadComplete(recordProvenance("PRODUCT_THUMBNAIL")),

  // Shop logo. Public by design.
  shopLogo: f(SHOP_LOGO_CONFIG)
    .input(shopScopedUpload)
    .middleware(requireShopMember)
    .onUploadComplete(recordProvenance("SHOP_LOGO")),

  // Shop cover/banner image. Public by design.
  shopCover: f(SHOP_COVER_CONFIG)
    .input(shopScopedUpload)
    .middleware(requireShopMember)
    .onUploadComplete(recordProvenance("SHOP_COVER")),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
