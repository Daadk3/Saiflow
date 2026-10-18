/**
 * The image hosts next.config.ts lets Vercel resize (`images.remotePatterns`),
 * mirrored here so a component can tell, before rendering, whether a URL can
 * go through the optimizer. Kept in step with next.config.ts by
 * tests/image-delivery.test.ts.
 *
 * Why it matters: product thumbnails used to be sent `unoptimized`, so every
 * card on the homepage downloaded the seller's original upload (up to ~1.9 MB
 * and 1,400×2,000 pixels) to show it at about 200×200. PageSpeed measured
 * 7 MB of the homepage's 7.2 MB in those images (2026-10-16). A URL on a host
 * not listed here is still shown as it is, unoptimized, rather than refused
 * by the optimizer and replaced with the fallback tile.
 */
const EXACT = ["utfs.io", "uploadthing.com", "sea1.ingest.uploadthing.com", "lh3.googleusercontent.com"];
/** `**.ufs.sh` and `*.uploadthing.com`: any subdomain of these. */
const SUFFIXES = [".ufs.sh", ".uploadthing.com"];

export function canOptimizeImage(src: string): boolean {
  // Images shipped with the site (/mascot.png) are always optimizable.
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return EXACT.includes(host) || SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}
