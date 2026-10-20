/**
 * Seller payouts, done by hand: SaiFlow's admin sends a bank transfer, then
 * records it here against exactly the orders it pays for.
 *
 * WHAT A SHOP IS OWED. The seller's share (`Order.sellerNetAmount`, the split
 * snapshotted at fulfilment by lib/pricing) of every order that:
 *   - was paid on Geidea's PRODUCTION account (TEST orders are never revenue),
 *   - is not a founder test (`founderTest`, lib/payments/live-mode), which is
 *     the founder's own money and is refunded, never paid out,
 *   - carries a split (orders fulfilled before the commission have none, and
 *     are never reinterpreted),
 *   - has not been paid out yet (`payoutId` is null), and
 *   - has CLEARED: it was paid at least CLEARING_DAYS ago.
 * An unpaid order still inside that window is "clearing": shown to the seller
 * with the date it clears, never paid. The window is there so that a refund,
 * a chargeback or a stolen card surfaces while the money is still SaiFlow's
 * to hold, not after it has gone to a seller who may have gone too.
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

/** Days between a sale and the day its share can be paid out. */
export const CLEARING_DAYS = 14;
const CLEARING_MS = CLEARING_DAYS * 24 * 60 * 60 * 1000;

/** Unpaid revenue, cleared or not; the one definition behind every view below. */
export const UNPAID_ORDERS_WHERE = {
  paymentEnvironment: "PRODUCTION" as const,
  founderTest: false,
  sellerNetAmount: { not: null },
  payoutId: null,
};

/** One shop's unpaid orders, cleared or not. */
export function unpaidOrdersWhere(shopId: string) {
  return { product: { shopId }, ...UNPAID_ORDERS_WHERE };
}

/** The newest sale that has finished clearing at `now`. */
export function clearingCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - CLEARING_MS);
}

/** When an order paid at `paidAt` becomes payable. */
export function clearsAt(paidAt: Date): Date {
  return new Date(paidAt.getTime() + CLEARING_MS);
}

/** Whether an order paid at `paidAt` may be paid out at `now`. */
export function hasCleared(paidAt: Date, now: Date = new Date()): boolean {
  return paidAt.getTime() <= clearingCutoff(now).getTime();
}

/**
 * The orders a shop may be paid for now: unpaid and cleared. The query the
 * admin's payout recording re-reads inside its transaction, so a payout can
 * never include an order still clearing.
 */
export function payableOrdersWhere(shopId: string, now: Date = new Date()) {
  return { ...unpaidOrdersWhere(shopId), createdAt: { lte: clearingCutoff(now) } };
}

/** Unpaid orders, split into those payable now and those still clearing. */
export function splitByClearing<T extends { createdAt: Date }>(orders: readonly T[], now: Date = new Date()) {
  const payable: T[] = [];
  const clearing: T[] = [];
  for (const order of orders) (hasCleared(order.createdAt, now) ? payable : clearing).push(order);
  return { payable, clearing };
}

/** The earliest date any of these orders clears; null when there are none. */
export function nextClearing(orders: ReadonlyArray<{ createdAt: Date }>): Date | null {
  let earliest: number | null = null;
  for (const order of orders) {
    const at = clearsAt(order.createdAt).getTime();
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest === null ? null : new Date(earliest);
}

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
