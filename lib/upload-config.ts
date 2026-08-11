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

/**
 * Applied to every deliverable type.
 *
 * `acl: "private"` is the point of this stage: the object is not readable by
 * URL at all, so an upload no longer mints a permanent public link to
 * unreviewed, unscanned seller content. Reads require a short-lived signed
 * URL minted server-side.
 *
 * `contentDisposition: "attachment"` is defence in depth behind that. Should a
 * signed URL ever be opened in a browser, the file downloads instead of
 * rendering — so seller-supplied content cannot execute in the opener's tab.
 * PR #35 removed the types that made that dangerous; this removes the
 * behaviour itself.
 *
 * Requires per-request ACL override to be enabled on the UploadThing app, and
 * a paid plan. Both are in place.
 */
const PRIVATE_DELIVERABLE = {
  acl: "private",
  contentDisposition: "attachment",
} as const;

export const PRODUCT_FILE_CONFIG = {
  // Documents
  pdf: { maxFileSize: "32MB", ...PRIVATE_DELIVERABLE },
  "application/epub+zip": { maxFileSize: "32MB", ...PRIVATE_DELIVERABLE },
  // Archives — ZIP only
  "application/zip": { maxFileSize: "128MB", ...PRIVATE_DELIVERABLE },
  // Audio
  audio: { maxFileSize: "128MB", ...PRIVATE_DELIVERABLE },
  // Video
  video: { maxFileSize: "256MB", ...PRIVATE_DELIVERABLE },
  // Images — raster only, never SVG
  ...rasterImages({ maxFileSize: "32MB", ...PRIVATE_DELIVERABLE }),
} as const;

/**
 * Listing artwork. Deliberately left `public-read` — a thumbnail exists to be
 * shown on a public product page, and signing it would break image
 * optimisation for no security gain. Raster-only still applies, which is what
 * makes leaving it public acceptable.
 */
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
