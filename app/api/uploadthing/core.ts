import { createUploadthing, type FileRouter } from "uploadthing/next";
import { getServerSession } from "next-auth";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
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

// FileRouter for your app, can contain multiple FileRoutes
export const ourFileRouter = {
  // The seller's deliverable. PRIVATE — see lib/upload-config.ts. Completing
  // an upload no longer produces a readable URL for anyone; reads require a
  // short-lived signed URL minted server-side.
  productFile: f(PRODUCT_FILE_CONFIG)
    .input(shopScopedUpload)
    .middleware(requireShopMember)
    .onUploadComplete(async ({ file, metadata }) => {
      // Log the key, not the URL: identifiers are enough to trace an upload,
      // and the URL is the (private) asset itself.
      console.log(
        `[upload] productFile key=${file.key} shop=${metadata.shopId} size=${file.size}`
      );
      return { url: file.ufsUrl };
    }),

  // Listing artwork. Public by design — see lib/upload-config.ts.
  productThumbnail: f(PRODUCT_THUMBNAIL_CONFIG)
    .input(shopScopedUpload)
    .middleware(requireShopMember)
    .onUploadComplete(async ({ file, metadata }) => {
      console.log(
        `[upload] productThumbnail key=${file.key} shop=${metadata.shopId}`
      );
      return { url: file.ufsUrl };
    }),

  // Shop logo. Public by design.
  shopLogo: f(SHOP_LOGO_CONFIG)
    .input(shopScopedUpload)
    .middleware(requireShopMember)
    .onUploadComplete(async ({ file, metadata }) => {
      console.log(`[upload] shopLogo key=${file.key} shop=${metadata.shopId}`);
      return { url: file.ufsUrl };
    }),

  // Shop cover/banner image. Public by design.
  shopCover: f(SHOP_COVER_CONFIG)
    .input(shopScopedUpload)
    .middleware(requireShopMember)
    .onUploadComplete(async ({ file, metadata }) => {
      console.log(`[upload] shopCover key=${file.key} shop=${metadata.shopId}`);
      return { url: file.ufsUrl };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
