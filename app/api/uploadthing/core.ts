import { createUploadthing, type FileRouter } from "uploadthing/next";

const f = createUploadthing();

// FileRouter for your app, can contain multiple FileRoutes
export const ourFileRouter = {
  // Define a route for product files - supports multiple file types
  productFile: f({
    // Documents
    pdf: { maxFileSize: "32MB" },
    "application/epub+zip": { maxFileSize: "32MB" },
    // Archives
    "application/zip": { maxFileSize: "512MB" },
    "application/x-rar-compressed": { maxFileSize: "512MB" },
    // Audio
    audio: { maxFileSize: "128MB" },
    // Video
    video: { maxFileSize: "512MB" },
    // Images
    image: { maxFileSize: "32MB" },
    // Text/Code
    text: { maxFileSize: "16MB" },
  })
    .middleware(async () => {
      return {};
    })
    .onUploadComplete(async ({ file }) => {
      console.log("Upload complete:", file.ufsUrl);
      return { url: file.ufsUrl };
    }),

  // Define a route for product thumbnails (images)
  productThumbnail: f({
    image: { maxFileSize: "16MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      return {};
    })
    .onUploadComplete(async ({ file }) => {
      console.log("Thumbnail upload complete:", file.ufsUrl);
      return { url: file.ufsUrl };
    }),

  // Define a route for shop logo
  shopLogo: f({
    image: { maxFileSize: "4MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      return {};
    })
    .onUploadComplete(async ({ file }) => {
      console.log("Shop logo upload complete:", file.ufsUrl);
      return { url: file.ufsUrl };
    }),

  // Define a route for shop cover/banner image
  shopCover: f({
    image: { maxFileSize: "8MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      return {};
    })
    .onUploadComplete(async ({ file }) => {
      console.log("Shop cover upload complete:", file.ufsUrl);
      return { url: file.ufsUrl };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
