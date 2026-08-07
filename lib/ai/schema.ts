/**
 * The input and output contract for the AI Listing Assistant.
 *
 * Both directions are validated with Zod. Model output is untrusted: it is
 * parsed, length-checked and category-checked before it can reach the UI, and
 * anything malformed is rejected rather than repaired.
 *
 * All generated content is plain text in v1 — no HTML, no Markdown rendering.
 */

import { z } from "zod";
import { PRODUCT_CATEGORIES } from "@/lib/categories";

export const LISTING_LANGUAGES = ["ar", "en"] as const;
export type ListingLanguage = (typeof LISTING_LANGUAGES)[number];

/** Maximum characters of creator-pasted detail accepted per request. */
export const MAX_DETAILS_CHARS = 5000;

export const listingInputSchema = z.object({
  shopId: z.string().min(1).max(64),
  language: z.enum(LISTING_LANGUAGES),
  category: z.enum(PRODUCT_CATEGORIES),
  title: z.string().trim().min(2).max(200),
  shortDescription: z.string().trim().max(600).optional().default(""),
  targetAudience: z.string().trim().max(300).optional().default(""),
  details: z.string().trim().max(MAX_DETAILS_CHARS).optional().default(""),
  /** Present when regenerating a single section rather than everything. */
  section: z
    .enum([
      "improvedTitle",
      "shortSummary",
      "fullDescription",
      "keyBenefits",
      "targetAudience",
      "faq",
      "cta",
      "seoTitle",
      "seoDescription",
      "suggestedCategory",
    ])
    .optional(),
});

export type ListingInput = z.infer<typeof listingInputSchema>;

export const faqItemSchema = z.object({
  question: z.string().trim().min(3).max(200),
  answer: z.string().trim().min(3).max(600),
});

/**
 * Model output. Lengths are enforced, not merely hinted — an over-long field
 * is a rejection, because silently truncating would put words in the
 * creator's mouth.
 */
export const listingOutputSchema = z.object({
  improvedTitle: z.string().trim().min(2).max(200),
  shortSummary: z.string().trim().min(10).max(300),
  fullDescription: z.string().trim().min(30).max(4000),
  keyBenefits: z.array(z.string().trim().min(3).max(200)).min(3).max(6),
  targetAudience: z.string().trim().min(3).max(300),
  faq: z.array(faqItemSchema).min(2).max(5),
  cta: z.string().trim().min(2).max(120),
  seoTitle: z.string().trim().min(5).max(60),
  seoDescription: z.string().trim().min(20).max(160),
  suggestedCategory: z.enum(PRODUCT_CATEGORIES),
});

export type ListingOutput = z.infer<typeof listingOutputSchema>;

/** Machine-readable error codes. Provider errors are never passed through. */
export const AI_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "FEATURE_DISABLED",
  "INVALID_INPUT",
  "RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ERROR",
  "INVALID_OUTPUT",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
