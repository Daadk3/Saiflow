/**
 * Optional long-form product page, and an optional compare-at price.
 *
 * Both are additive. A product with neither (every product that exists today,
 * and any seller who leaves the new fields blank) stores NULL, and the public
 * page renders exactly as before.
 *
 * THE PRICE THE BUYER PAYS IS `price`. compareAtPrice is a display of the
 * price the seller says the product used to cost, or the sum of items sold
 * separately. It is shown struck through only when it is strictly greater
 * than `price`. Checkout, the order, and the commission never read it.
 *
 * THE PAGE TEXT is seller content, so it takes the same contact check as the
 * title and description (lib/review-checklist `findContactInfo`, the check
 * lib/file-facts runs on a file). A phone, email, link, handle, or invitation
 * to talk off SaiFlow is refused here, before it can be stored. Length limits
 * are enforced here too. The review checklist scans the stored text again, so
 * a row written some other way is still flagged.
 *
 * Pure and client-safe: no Prisma, no Node APIs. The database write that
 * turns a cleared landing into SQL NULL lives in lib/products/listing-write.
 */

import { findContactInfo } from "@/lib/review-checklist";
import { halalasToNumber, parseMoney, validatePrice } from "@/lib/pricing";

export const LANDING_LIMITS = {
  benefits: { max: 8, item: 180 },
  included: { max: 16, item: 180 },
  faq: { max: 8, question: 160, answer: 500 },
  guarantee: 400,
  audience: 280,
} as const;

export interface ProductFaq {
  question: string;
  answer: string;
}

/** The shape the public page renders. Empty lists and null notes are absent content. */
export interface ProductLanding {
  benefits: string[];
  included: string[];
  faq: ProductFaq[];
  guarantee: string | null;
  audience: string | null;
}

export interface ListingError {
  ok: false;
  error: string;
  errorAr: string;
}

export interface ListingFormValue {
  compareAtPrice: string;
  benefits: string;
  included: string;
  audience: string;
  guarantee: string;
  faq: ProductFaq[];
}

export function emptyListingForm(): ListingFormValue {
  return { compareAtPrice: "", benefits: "", included: "", audience: "", guarantee: "", faq: [] };
}

/** What the seller form sends. Null clears a value the product already has. */
export interface ListingInput {
  compareAtPrice: string | null;
  landing: Record<string, unknown> | null;
}

function clean(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

function tooLong(what: string, whatAr: string, max: number): ListingError {
  return {
    ok: false,
    error: `${what} must be at most ${max} characters.`,
    errorAr: `يجب ألا يتجاوز ${whatAr} ${max} حرفًا.`,
  };
}

function tooMany(max: number): ListingError {
  return {
    ok: false,
    error: `That section can have at most ${max} items.`,
    errorAr: `يمكن أن يحتوي هذا القسم على ${max} عناصر كحد أقصى.`,
  };
}

const SHAPE: ListingError = {
  ok: false,
  error: "The product page sections are not in a valid shape.",
  errorAr: "أقسام صفحة المنتج ليست بالصيغة الصحيحة.",
};

const CONTACT: ListingError = {
  ok: false,
  error: "The product page cannot include a phone number, email, link, or other contact outside SaiFlow.",
  errorAr: "لا يمكن أن تحتوي صفحة المنتج على رقم أو بريد أو رابط أو وسيلة تواصل خارج SaiFlow.",
};

const COMPARE_INVALID: ListingError = {
  ok: false,
  error: "The original price must be a valid amount in SAR, with at most two decimal places, up to 100,000.",
  errorAr: "يجب أن يكون السعر الأصلي مبلغًا صحيحًا بالريال، بخانتين عشريتين كحد أقصى، وحتى 100,000.",
};

const COMPARE_NOT_HIGHER: ListingError = {
  ok: false,
  error: "The original price must be higher than the selling price. Buyers are charged the selling price only.",
  errorAr: "يجب أن يكون السعر الأصلي أعلى من سعر البيع. يدفع المشتري سعر البيع فقط.",
};

function readStrings(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = clean(item).slice(0, maxLen);
    if (text) items.push(text);
    if (items.length >= maxItems) break;
  }
  return items;
}

function readText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const text = clean(value).slice(0, maxLen);
  return text || null;
}

function readFaq(value: unknown): ProductFaq[] {
  if (!Array.isArray(value)) return [];
  const items: ProductFaq[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const question = readText(row.question, LANDING_LIMITS.faq.question);
    const answer = readText(row.answer, LANDING_LIMITS.faq.answer);
    if (question && answer) items.push({ question, answer });
    if (items.length >= LANDING_LIMITS.faq.max) break;
  }
  return items;
}

/** A stored JSON value, or anything that is not one, as page content. Invalid JSON renders nothing. */
export function readLanding(value: unknown): ProductLanding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const landing: ProductLanding = {
    benefits: readStrings(row.benefits, LANDING_LIMITS.benefits.max, LANDING_LIMITS.benefits.item),
    included: readStrings(row.included, LANDING_LIMITS.included.max, LANDING_LIMITS.included.item),
    faq: readFaq(row.faq),
    guarantee: readText(row.guarantee, LANDING_LIMITS.guarantee),
    audience: readText(row.audience, LANDING_LIMITS.audience),
  };
  return hasLandingContent(landing) ? landing : null;
}

export function hasLandingContent(landing: ProductLanding | null): boolean {
  if (!landing) return false;
  return (
    landing.benefits.length > 0 ||
    landing.included.length > 0 ||
    landing.faq.length > 0 ||
    Boolean(landing.guarantee) ||
    Boolean(landing.audience)
  );
}

/** Every seller-written string on the page, one per line, for the contact check and the review checklist. */
export function landingPlainText(landing: ProductLanding | null): string {
  if (!landing) return "";
  return [
    landing.audience ?? "",
    ...landing.benefits,
    ...landing.included,
    ...landing.faq.flatMap((item) => [item.question, item.answer]),
    landing.guarantee ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseStringList(
  value: unknown,
  maxItems: number,
  maxLen: number,
  what: string,
  whatAr: string
): { ok: true; items: string[] } | ListingError {
  if (value === undefined || value === null) return { ok: true, items: [] };
  if (!Array.isArray(value)) return SHAPE;
  if (value.length > maxItems) return tooMany(maxItems);
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return SHAPE;
    const text = clean(item);
    if (!text) continue;
    if (text.length > maxLen) return tooLong(what, whatAr, maxLen);
    items.push(text);
  }
  return { ok: true, items };
}

function parseNote(
  value: unknown,
  maxLen: number,
  what: string,
  whatAr: string
): { ok: true; text: string | null } | ListingError {
  if (value === undefined || value === null || value === "") return { ok: true, text: null };
  if (typeof value !== "string") return SHAPE;
  const text = clean(value);
  if (!text) return { ok: true, text: null };
  if (text.length > maxLen) return tooLong(what, whatAr, maxLen);
  return { ok: true, text };
}

/**
 * Validate a landing payload. `null` and an empty payload clear the column.
 * A non-object is refused. Contact details are refused. Over-long text is refused.
 */
export function parseLanding(value: unknown): { ok: true; landing: ProductLanding | null } | ListingError {
  if (value === null) return { ok: true, landing: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) return SHAPE;
  const row = value as Record<string, unknown>;

  const benefits = parseStringList(row.benefits, LANDING_LIMITS.benefits.max, LANDING_LIMITS.benefits.item, "A benefit", "كل فائدة");
  if (!benefits.ok) return benefits;
  const included = parseStringList(row.included, LANDING_LIMITS.included.max, LANDING_LIMITS.included.item, "An included item", "كل عنصر");
  if (!included.ok) return included;
  const audience = parseNote(row.audience, LANDING_LIMITS.audience, "Who it's for", "حقل «لمن هذا المنتج»");
  if (!audience.ok) return audience;
  const guarantee = parseNote(row.guarantee, LANDING_LIMITS.guarantee, "The guarantee", "ملاحظة الضمان");
  if (!guarantee.ok) return guarantee;

  const faq: ProductFaq[] = [];
  if (row.faq !== undefined && row.faq !== null) {
    if (!Array.isArray(row.faq)) return SHAPE;
    if (row.faq.length > LANDING_LIMITS.faq.max) return tooMany(LANDING_LIMITS.faq.max);
    for (const item of row.faq) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return SHAPE;
      const pair = item as Record<string, unknown>;
      const question = parseNote(pair.question, LANDING_LIMITS.faq.question, "A question", "السؤال");
      if (!question.ok) return question;
      const answer = parseNote(pair.answer, LANDING_LIMITS.faq.answer, "An answer", "الجواب");
      if (!answer.ok) return answer;
      if (!question.text && !answer.text) continue;
      if (!question.text || !answer.text) return SHAPE;
      faq.push({ question: question.text, answer: answer.text });
    }
  }

  const landing: ProductLanding = {
    benefits: benefits.items,
    included: included.items,
    faq,
    guarantee: guarantee.text,
    audience: audience.text,
  };
  if (!hasLandingContent(landing)) return { ok: true, landing: null };
  if (findContactInfo(landingPlainText(landing)).length > 0) return CONTACT;
  return { ok: true, landing };
}

/**
 * `null` or a blank string clears the compare-at price. A real amount must be
 * exact money and strictly greater than the selling price, in halalas.
 */
export function parseCompareAt(
  value: unknown,
  sellingPrice: string
): { ok: true; compareAtPrice: string | null } | ListingError {
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: true, compareAtPrice: null };
  }
  const selling = parseMoney(sellingPrice);
  if (selling === null) {
    return {
      ok: false,
      error: "Price must be a valid amount in SAR",
      errorAr: "يجب أن يكون السعر مبلغًا صحيحًا بالريال.",
    };
  }
  const check = validatePrice(value);
  if (!check.ok) return COMPARE_INVALID;
  if (check.halalas <= selling) return COMPARE_NOT_HIGHER;
  return { ok: true, compareAtPrice: check.price };
}

export interface PublicOffer {
  /** The compare-at amount, for display only. */
  compareAt: number;
  /** Whole percent off, or null when the gap rounds to under 1%. */
  percent: number | null;
}

/**
 * The strike-through offer, or null when there is nothing honest to show.
 * Equal and lower compare-at prices are not a discount. Arithmetic is in
 * halalas; the numbers returned are for a currency formatter only.
 */
export function publicOffer(price: unknown, compareAt: unknown): PublicOffer | null {
  const priceHalalas = parseMoney(price);
  const compareHalalas = parseMoney(compareAt);
  if (priceHalalas === null || compareHalalas === null) return null;
  if (compareHalalas <= priceHalalas) return null;
  // Floor, so the badge never claims a larger saving than the prices support.
  const percent = Math.floor(((compareHalalas - priceHalalas) * 100) / compareHalalas);
  return {
    compareAt: halalasToNumber(compareHalalas),
    percent: percent >= 1 ? percent : null,
  };
}

export function listingFormFromProduct(product: {
  compareAtPrice?: unknown;
  landing?: unknown;
}): ListingFormValue {
  const landing = readLanding(product.landing);
  const compare = product.compareAtPrice;
  return {
    compareAtPrice: compare === null || compare === undefined || compare === "" ? "" : String(compare),
    benefits: landing?.benefits.join("\n") ?? "",
    included: landing?.included.join("\n") ?? "",
    audience: landing?.audience ?? "",
    guarantee: landing?.guarantee ?? "",
    faq: landing?.faq ?? [],
  };
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => clean(line))
    .filter(Boolean);
}

/** The JSON the add and edit forms submit. The server validates it again. */
export function listingFormToBody(value: ListingFormValue): ListingInput {
  const benefits = splitLines(value.benefits);
  const included = splitLines(value.included);
  const faq = value.faq
    .map((item) => ({ question: clean(item.question), answer: clean(item.answer) }))
    .filter((item) => item.question || item.answer);
  const audience = clean(value.audience);
  const guarantee = clean(value.guarantee);
  const landing =
    benefits.length === 0 && included.length === 0 && faq.length === 0 && !audience && !guarantee
      ? null
      : {
          ...(benefits.length ? { benefits } : {}),
          ...(included.length ? { included } : {}),
          ...(faq.length ? { faq } : {}),
          ...(audience ? { audience } : {}),
          ...(guarantee ? { guarantee } : {}),
        };
  return {
    compareAtPrice: value.compareAtPrice.trim() === "" ? null : value.compareAtPrice.trim(),
    landing,
  };
}
