/**
 * What a buyer is allowed to write on a review.
 *
 * Stars are 1–5. The words are optional, short, and plain text. The same
 * contact checks the listing review uses (lib/review-checklist) refuse a
 * link, a phone number, an email, a handle or an off-platform invitation,
 * so a review cannot become an advertisement. Markup is refused rather than
 * stripped, so what was stored is what was typed.
 */

import { z } from "zod";
import { findAmbiguousPlatform, findContactInfo } from "@/lib/review-checklist";

export const REVIEW_BODY_MAX = 500;
export const REVIEW_REASON_MAX = 500;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Control characters other than tab and newline. Reviews are plain text, not documents. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const reviewSubmitSchema = z.object({
  productId: z.string().regex(ID),
  stars: z.number().int().min(1).max(5),
  body: z.string().optional(),
  token: z.string().min(10).max(300).optional(),
  orderId: z.string().regex(ID).optional(),
});

export type ReviewTextError = "too_long" | "markup" | "contact";

/**
 * The body to store, or null when the buyer left it blank. A problem is a
 * refusal, not a cleaned-up version of what they typed.
 */
export function reviewBody(value: unknown): { ok: true; text: string | null } | { ok: false; error: ReviewTextError } {
  if (value === undefined || value === null) return { ok: true, text: null };
  if (typeof value !== "string") return { ok: false, error: "markup" };
  if (value.length > REVIEW_BODY_MAX) return { ok: false, error: "too_long" };
  const text = value.trim();
  if (text.length === 0) return { ok: true, text: null };
  if (text.length > REVIEW_BODY_MAX) return { ok: false, error: "too_long" };
  if (/[<>]/.test(text) || CONTROL.test(text)) return { ok: false, error: "markup" };
  if (findContactInfo(text).length > 0 || findAmbiguousPlatform(text)) return { ok: false, error: "contact" };
  return { ok: true, text };
}

/** A seller's report, or an admin's hide reason. Plain text, required. */
export function reviewReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 3 || text.length > REVIEW_REASON_MAX) return null;
  if (/[<>]/.test(text) || CONTROL.test(text)) return null;
  return text;
}
