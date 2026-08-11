import { createUploadthing, type FileRouter } from "uploadthing/next";
import { getServerSession } from "next-auth";
import { UploadThingError } from "uploadthing/server";
import { authOptions } from "../auth/authOptions";
import {
  PRODUCT_FILE_CONFIG,
  PRODUCT_THUMBNAIL_CONFIG,
  SHOP_LOGO_CONFIG,
  SHOP_COVER_CONFIG,
} from "@/lib/upload-config";

const f = createUploadthing();

// P0: require an authenticated user before any upload is accepted.
// Anonymous uploads are rejected before any file is stored.
const requireUser = async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new UploadThingError("Unauthorized");
  }
  return { userEmail: session.user.email };
};

// FileRouter for your app, can contain multiple FileRoutes
export const ourFileRouter = {
  // Define a route for product files - supports multiple file types.
  // Accepted types and size ceilings live in lib/upload-config.ts.
  productFile: f(PRODUCT_FILE_CONFIG)
    .middleware(async () => await requireUser())
    .onUploadComplete(async ({ file }) => {
      console.log("Upload complete:", file.ufsUrl);
      return { url: file.ufsUrl };
    }),

  // Define a route for product thumbnails (images)
  productThumbnail: f(PRODUCT_THUMBNAIL_CONFIG)
    .middleware(async () => await requireUser())
    .onUploadComplete(async ({ file }) => {
      console.log("Thumbnail upload complete:", file.ufsUrl);
      return { url: file.ufsUrl };
    }),

  // Define a route for shop logo
  shopLogo: f(SHOP_LOGO_CONFIG)
    .middleware(async () => await requireUser())
    .onUploadComplete(async ({ file }) => {
      console.log("Shop logo upload complete:", file.ufsUrl);
      return { url: file.ufsUrl };
    }),

  // Define a route for shop cover/banner image
  shopCover: f(SHOP_COVER_CONFIG)
    .middleware(async () => await requireUser())
    .onUploadComplete(async ({ file }) => {
      console.log("Shop cover upload complete:", file.ufsUrl);
      return { url: file.ufsUrl };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
