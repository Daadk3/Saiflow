/**
 * Seller payouts, done by hand: SaiFlow's admin sends a bank transfer, then
 * records it here against exactly the orders it pays for.
 *
 * WHAT A SHOP IS OWED. The seller's share (`Order.sellerNetAmount`, the split
 * snapshotted at fulfilment by lib/pricing) of every order that:
 *   - was paid on Geidea's PRODUCTION account (TEST orders are never revenue),
 *   - carries a split (orders fulfilled before the commission have none, and
 *     are never reinterpreted), and
 *   - has not been paid out yet (`payoutId` is null).
 * Nothing here moves money. Nothing here reads a request.
 *
 * KNOWN GAP, recorded rather than hidden: an Order has no refund state yet.
 * Until refunds are recorded on the Order, the admin must check Geidea for
 * refunds and chargebacks before paying, and must not pay an order that was
 * refunded. Refund handling is a launch gate of its own.
 *
 * BANK DETAILS ARE PERSONAL DATA. Only the shop's OWNER and SaiFlow's admins
 * read them, and both see them masked except where the admin needs the full
 * number to send the transfer. A payout keeps only the last four characters
 * of the IBAN it was paid to.
 */

import { fromHalalas, parseMoney } from "@/lib/pricing";

/** Every SaiFlow price is in riyals; payouts are made in the same currency. */
export const PAYOUT_CURRENCY = "SAR";

/** A Saudi IBAN: "SA", two check digits, a two-digit bank code, eighteen account characters. */
const SAUDI_IBAN = /^SA\d{4}[0-9A-Z]{18}$/;

/** A payout account changed this recently is flagged to the admin before paying. */
export const RECENT_CHANGE_MS = 7 * 24 * 60 * 60 * 1000;

const CONTROL = /[\u0000-\u001f\u007f]/;

/** ISO 13616 mod-97 check on an IBAN already in canonical form. */
function ibanChecksumValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** A Saudi IBAN in canonical form (no spaces, upper case), or null if it is not a valid one. */
export function normalizeIban(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iban = value.replace(/[\s-]/g, "").toUpperCase();
  if (!SAUDI_IBAN.test(iban)) return null;
  return ibanChecksumValid(iban) ? iban : null;
}

/** For display everywhere except the admin's transfer screen: the country and the last four. */
export function maskIban(iban: string): string {
  return `${iban.slice(0, 2)}•• •••• •••• •••• •••• ${iban.slice(-4)}`;
}

/** The account holder's name as entered, trimmed; null when empty, too long or not plain text. */
export function normalizeHolderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100 || CONTROL.test(name)) return null;
  return name;
}

/** The bank's name, optional; null when absent, undefined when present but unusable. */
export function normalizeBankName(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length === 0) return null;
  if (name.length > 100 || CONTROL.test(name)) return undefined;
  return name;
}

/** The bank's own reference for a transfer the admin has made. */
export function normalizeBankReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reference = value.trim();
  if (reference.length < 3 || reference.length > 100 || CONTROL.test(reference)) return null;
  return reference;
}

/** The orders a shop has not been paid for yet. The one definition, for the seller's view and the admin's. */
export function payableOrdersWhere(shopId: string) {
  return {
    product: { shopId },
    paymentEnvironment: "PRODUCTION" as const,
    sellerNetAmount: { not: null },
    payoutId: null,
  };
}

/** All payable orders, across shops; the admin's overview. */
export const PAYABLE_ORDERS_WHERE = {
  paymentEnvironment: "PRODUCTION" as const,
  sellerNetAmount: { not: null },
  payoutId: null,
};

export interface Owed {
  /** Two decimals, in riyals; from halalas, never through a float. */
  amount: string;
  halalas: number;
  orderCount: number;
  /** Orders whose stored share could not be read as money: never counted, always reported. */
  unreadable: number;
}

/** What a list of payable orders adds up to. */
export function owedFor(orders: Array<{ sellerNetAmount: unknown }>): Owed {
  let halalas = 0;
  let orderCount = 0;
  let unreadable = 0;
  for (const order of orders) {
    const value = parseMoney(order.sellerNetAmount);
    if (value === null) {
      unreadable++;
      continue;
    }
    halalas += value;
    orderCount++;
  }
  return { amount: fromHalalas(halalas), halalas, orderCount, unreadable };
}

/** Whether a payout account was changed recently enough that the admin should confirm it first. */
export function changedRecently(updatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - updatedAt.getTime() < RECENT_CHANGE_MS;
}
