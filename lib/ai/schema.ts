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

/**
 * The same output contract expressed as JSON Schema, for providers that
 * support schema-constrained decoding (OpenAI Structured Outputs).
 *
 * Kept beside the Zod schema on purpose: the two must describe the same
 * object, and a reviewer should be able to check that in one screen.
 *
 * Two deliberate differences from the Zod schema:
 *
 * 1. No length or item-count keywords. OpenAI's strict mode rejects
 *    `minLength`, `maxLength`, `minItems` and `maxItems` with a 400, and would
 *    not enforce them even if accepted — strict mode constrains shape, not
 *    content. The limits therefore live in the descriptions, where the model
 *    can act on them, and stay enforced by Zod, which is the only layer that
 *    actually guarantees them.
 * 2. Every property appears in `required` and every object sets
 *    `additionalProperties: false`, both of which strict mode demands.
 *
 * Structured Outputs removes malformed-JSON and missing-field failures. It
 * does not remove the need to validate: Zod still rejects over-long fields and
 * remains the last word on what may reach a creator.
 */
export const LISTING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    improvedTitle: {
      type: "string",
      description: "Improved product title, 2-200 characters.",
    },
    shortSummary: {
      type: "string",
      description: "One-sentence summary, 10-300 characters.",
    },
    fullDescription: {
      type: "string",
      description:
        "Full listing description in plain text, 30-4000 characters. No Markdown, no HTML.",
    },
    keyBenefits: {
      type: "array",
      description: "Between 3 and 6 concrete benefits, each 3-200 characters.",
      items: { type: "string" },
    },
    targetAudience: {
      type: "string",
      description: "Who the product is for, 3-300 characters.",
    },
    faq: {
      type: "array",
      description: "Between 2 and 5 question-and-answer pairs.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string", description: "3-200 characters." },
          answer: { type: "string", description: "3-600 characters." },
        },
        required: ["question", "answer"],
      },
    },
    cta: {
      type: "string",
      description: "Short call to action, 2-120 characters.",
    },
    seoTitle: {
      type: "string",
      description:
        "Search-engine title. Must not exceed 60 characters — count them.",
    },
    seoDescription: {
      type: "string",
      description:
        "Search-engine description. Must not exceed 160 characters — count them.",
    },
    suggestedCategory: {
      type: "string",
      description: "Must be one of the approved marketplace categories.",
      enum: [...PRODUCT_CATEGORIES],
    },
  },
  required: [
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
  ],
} as const;

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
