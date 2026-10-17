import {
  PRODUCT_FILE_CONFIG,
  PRODUCT_THUMBNAIL_CONFIG,
  SHOP_COVER_CONFIG,
  SHOP_LOGO_CONFIG,
} from "@/lib/upload-config";

/**
 * What each upload button accepts, in words a seller reads ("JPG, PNG, WEBP:
 * up to 16 MB") instead of UploadThing's own list ("Image/jpegs,
 * image/pngs…"), which pluralises MIME types and is English only.
 *
 * Derived from lib/upload-config, the configs the upload routes enforce, so
 * the label can never promise a type or a size the server refuses.
 *
 * Pure and client-safe. "audio" and "video" come back as words to translate;
 * every other label is a file extension, the same in every language.
 */

export type UploadEndpoint = "productFile" | "productThumbnail" | "shopLogo" | "shopCover";

const CONFIGS: Record<UploadEndpoint, Record<string, { maxFileSize: string }>> = {
  productFile: PRODUCT_FILE_CONFIG,
  productThumbnail: PRODUCT_THUMBNAIL_CONFIG,
  shopLogo: SHOP_LOGO_CONFIG,
  shopCover: SHOP_COVER_CONFIG,
};

const LABELS: Record<string, string> = {
  pdf: "PDF",
  "application/epub+zip": "EPUB",
  "application/zip": "ZIP",
  audio: "audio",
  video: "video",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "image/gif": "GIF",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
  "image/avif": "AVIF",
};

/** "32MB" → "32 MB". */
function readableSize(size: string): string {
  return size.replace(/^(\d+)([KMG]B)$/, "$1 $2");
}

/** The endpoint's types grouped by size limit, in the config's own order. */
export function allowedGroups(endpoint: UploadEndpoint): Array<{ labels: string[]; maxSize: string }> {
  const groups: Array<{ labels: string[]; maxSize: string }> = [];
  for (const [type, rule] of Object.entries(CONFIGS[endpoint])) {
    const label = LABELS[type] ?? type.toUpperCase();
    const maxSize = readableSize(rule.maxFileSize);
    const group = groups.find((g) => g.maxSize === maxSize);
    if (group) group.labels.push(label);
    else groups.push({ labels: [label], maxSize });
  }
  return groups;
}
