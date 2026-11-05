/**
 * The review label for a local HTML app archive.
 *
 * This module is intentionally tiny and free of Node APIs. The checklist and
 * the admin pages import it, including from client components, so it must not
 * pull in the scanner, zlib, or anything that reads a file.
 *
 * The string is an allowlisted kind, not a description and not a delivery
 * instruction. Callers may turn it into a boolean or a fixed sentence. They
 * must not echo any other field stored next to it.
 */

export const LOCAL_HTML_APP_KIND = "local_html_app";

/** True only for the exact kind the scanner writes. Anything else is not this product. */
export function isLocalHtmlAppReview(facts: unknown): boolean {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return false;
  return (facts as { kind?: unknown }).kind === LOCAL_HTML_APP_KIND;
}
