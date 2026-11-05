/**
 * What a browser should see when admin inspection refuses.
 *
 * `/api/admin/inspect/[productId]` is an API. A permitted inspection redirects
 * to a short-lived signed URL, so a browser never renders a body. A refusal
 * is JSON. The moderation queue and the products directory link that URL
 * directly, so a blocked file — which the policy correctly refuses — shows
 * up as a raw `{"error":"unsafe","scan":"unsafe"}` document.
 *
 * A document navigation is sent to the admin review page instead. That page
 * already explains the gate and does not serve the file. The redirect is
 * relative, so it cannot be aimed at another host, and the only query value
 * interpolated is one of the refusal codes below. Programmatic clients, which
 * do not navigate, still receive the JSON refusal.
 *
 * This module does not decide whether the file may be opened. The route asks
 * `inspectProduct` first and calls here only after a refusal.
 */

import type { InspectRefusal } from "@/lib/inspect";

/** Refusals a browser may be sent onward for. Never a permission. */
const DOCUMENT_REFUSALS: readonly InspectRefusal[] = [
  "unsafe",
  "no_file",
  "unknown_state",
  "unverified",
];

/**
 * True when the request is a browser navigation rather than an API call.
 *
 * `Sec-Fetch-Dest: document` is set on address-bar visits and on clicks, and
 * is `empty` for `fetch`. Older clients omit that header and send
 * `Accept: text/html` instead. An explicit `application/json` preference
 * keeps the JSON body, so a client that asks for both is not rewritten.
 */
export function isInspectDocumentNavigation(req: Request): boolean {
  const dest = req.headers.get("sec-fetch-dest");
  if (dest === "document" || dest === "iframe") return true;

  const accept = req.headers.get("accept");
  if (!accept) return false;

  let html = 0;
  let json = 0;
  let sawHtml = false;
  for (const raw of accept.split(",")) {
    const part = raw.trim().toLowerCase();
    const type = part.split(";", 1)[0]?.trim() ?? "";
    const qMatch = part.match(/;\s*q=([0-9.]+)/);
    const parsed = qMatch ? Number(qMatch[1]) : 1;
    const q = Number.isFinite(parsed) ? parsed : 0;
    if (type === "text/html" || type === "application/xhtml+xml") {
      sawHtml = true;
      html = Math.max(html, q);
    } else if (type === "application/json") {
      json = Math.max(json, q);
    }
  }
  return sawHtml && html > json;
}

/**
 * Relative URL of the review page for a refused inspection.
 *
 * Null when the id or the code is not one of the shapes this function builds
 * itself. The caller then keeps the JSON refusal rather than inventing a
 * location. The id is a single path segment: slashes, dots, queries and
 * schemes never get through the pattern.
 */
export function inspectRefusalLocation(
  productId: string,
  code: string
): string | null {
  if (!DOCUMENT_REFUSALS.includes(code as InspectRefusal)) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(productId)) return null;
  return `/dashboard/admin/products/${productId}/preview?inspection=${code}#file-safety`;
}

/** The `inspection` query the review page may notice. It is not a verdict. */
export function isInspectionRefusalHint(value: unknown): boolean {
  return typeof value === "string" && DOCUMENT_REFUSALS.includes(value as InspectRefusal);
}
