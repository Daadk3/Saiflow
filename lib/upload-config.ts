/**
 * What the upload routes accept.
 *
 * Kept out of `app/api/uploadthing/core.ts` so the policy can be tested
 * against UploadThing's own `matchFileType` without dragging NextAuth and
 * Prisma into the test process. `core.ts` answers "who may upload"; this file
 * answers "what may exist at all".
 *
 * SCOPE, stated plainly: this is attack-surface reduction, NOT malware
 * protection. Nothing here reads a single byte of any file. UploadThing
 * decides a file's type from the browser's claim, falling back to the
 * filename extension (`@uploadthing/shared`: `file.type || lookup(file.name)`),
 * so a renamed executable still passes. Real content scanning is a separate,
 * still-outstanding requirement that blocks enabling payments.
 */

/**
 * Raster image formats, enumerated one MIME type at a time.
 *
 * The `image` shorthand cannot be used here. UploadThing expands it to
 * `image/*` (`@uploadthing/shared`: `if (type === "image") return ["image/*",
 * ...]`), and `image/*` includes `image/svg+xml`. An SVG is an XML document
 * that may carry `<script>`, and storage serves uploads with
 * `content-disposition: inline` — so an accepted SVG becomes a public URL that
 * runs script in whoever opens it. Enumerating the raster types is the only
 * way to keep image uploads while refusing SVG.
 *
 * None of these formats can carry script. Every image in production today is
 * JPEG or PNG; the rest are kept because `image/*` already accepted them and
 * dropping them would break phone-camera (HEIC/HEIF) and modern-format
 * uploads. Deliberately NOT re-listed: BMP, TIFF and PSD — raster, but unused
 * and easily shipped inside a ZIP.
 *
 * The `const` type parameter keeps `"32MB"` a literal, so UploadThing's
 * `FileSize` template type still rejects a bad size at the call site.
 */
const rasterImages = <const C extends { maxFileSize: string }>(config: C) => ({
  "image/jpeg": config,
  "image/png": config,
  "image/webp": config,
  "image/gif": config,
  "image/heic": config,
  "image/heif": config,
  "image/avif": config,
});

/**
 * The seller's deliverable — the only route whose output is sold to a buyer.
 *
 * Absent on purpose:
 * - `text` — expands to `text/*`, which includes `text/html`. HTML uploaded
 *   here would be served inline from a public URL: free phishing hosting.
 * - `application/x-rar-compressed` — a second archive format with no
 *   legitimate need here, its own decoder CVE history, and the same
 *   executable-smuggling profile as ZIP. ZIP remains.
 * - the `image` shorthand — see `rasterImages` above.
 *
 * Archive and video ceilings are cut (512MB → 128MB / 256MB) so that a future
 * scanner can fetch and forward a file inside one serverless invocation. The
 * largest asset in production today is under 2MB.
 */
export const PRODUCT_FILE_CONFIG = {
  // Documents
  pdf: { maxFileSize: "32MB" },
  "application/epub+zip": { maxFileSize: "32MB" },
  // Archives — ZIP only
  "application/zip": { maxFileSize: "128MB" },
  // Audio
  audio: { maxFileSize: "128MB" },
  // Video
  video: { maxFileSize: "256MB" },
  // Images — raster only, never SVG
  ...rasterImages({ maxFileSize: "32MB" }),
} as const;

/** Listing artwork. Public the moment it is uploaded, so raster-only too. */
export const PRODUCT_THUMBNAIL_CONFIG = {
  ...rasterImages({ maxFileSize: "16MB", maxFileCount: 1 }),
} as const;

/**
 * Shop branding. Same rule, and not an afterthought: these routes are open to
 * any signed-in user, so leaving `image/*` here would have left the SVG hole
 * fully open no matter what the product route allowed.
 */
export const SHOP_LOGO_CONFIG = {
  ...rasterImages({ maxFileSize: "4MB", maxFileCount: 1 }),
} as const;

export const SHOP_COVER_CONFIG = {
  ...rasterImages({ maxFileSize: "8MB", maxFileCount: 1 }),
} as const;
