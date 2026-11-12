/**
 * Platform WhatsApp for buyer questions. NovaSphere's business line.
 *
 * The public header is the only place this link is rendered. Change the
 * number here, or set NEXT_PUBLIC_WHATSAPP_E164 (digits, country code, no
 * plus) and optionally NEXT_PUBLIC_WHATSAPP_PREFILL. An empty or unusable
 * value keeps the default below.
 *
 * Seller listing review does not import this module. Point 6
 * (lib/review-checklist.ts) searches the product title, the product
 * description, and text extracted from the uploaded file. A wa.me link or
 * this phone number inside those would still be flagged. Do not copy this
 * href into a title, description, file, or hosted-access instructions.
 */

export const WHATSAPP_E164_DEFAULT = "966552319350";

/** Short Arabic opener, sent as the wa.me `text` query. */
export const WHATSAPP_PREFILL_DEFAULT = "مرحبا، عندي سؤال عن SaiFlow";

const E164_MIN = 8;
const E164_MAX = 15;
const PREFILL_MAX = 300;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** E.164 digits for wa.me, without a leading plus. */
export function whatsAppE164(): string {
  const fromEnv = digitsOnly(process.env.NEXT_PUBLIC_WHATSAPP_E164 ?? "");
  if (fromEnv.length >= E164_MIN && fromEnv.length <= E164_MAX) return fromEnv;
  return WHATSAPP_E164_DEFAULT;
}

export function whatsAppPrefill(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_WHATSAPP_PREFILL ?? "").trim();
  if (fromEnv.length > 0 && fromEnv.length <= PREFILL_MAX) return fromEnv;
  return WHATSAPP_PREFILL_DEFAULT;
}

/** https://wa.me link with the prefilled question, safe to put in an href. */
export function whatsAppContactHref(): string {
  return `https://wa.me/${whatsAppE164()}?text=${encodeURIComponent(whatsAppPrefill())}`;
}
