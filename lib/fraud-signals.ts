/**
 * Warning signs of a fraudulent sale, read from data SaiFlow already holds.
 *
 * A marketplace is used to launder money when a seller pays for their own
 * product with a stolen or borrowed card and collects the payout. The two
 * signs SaiFlow can see without any card data:
 *   - the buyer's email belongs to someone in the seller's own shop, and
 *   - one buyer paying the same shop again and again.
 * Checkout refuses the first outright (app/api/checkout). Both are shown to
 * the admin beside every payout, which is a person's decision, never this
 * file's: a returning buyer is usually a happy customer.
 *
 * Card-level signals (one card across many purchases, a burst of declined
 * cards) live with the payment provider, which sees the card; SaiFlow never
 * does.
 *
 * Pure: no database, no request, no logging. Emails are compared, never
 * returned, so nothing here can leak a buyer's address into a response.
 */

/** Unpaid orders from one buyer to one shop at or above this count are flagged. */
export const REPEAT_BUYER_THRESHOLD = 3;

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * One address per mailbox, so the usual ways of writing the same mailbox
 * twice compare equal: letter case, a "+tag" after the name (which most
 * providers deliver to the same inbox), and for Gmail the dots in the name.
 * Used for comparison only; the address stored and emailed is never changed.
 */
export function canonicalEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/** Whether this buyer address is the mailbox of anyone in the selling shop. */
export function isShopMemberEmail(buyerEmail: string, memberEmails: readonly string[]): boolean {
  const buyer = canonicalEmail(buyerEmail);
  return memberEmails.some((email) => canonicalEmail(email) === buyer);
}

export interface PayoutWarnings {
  /** Orders whose buyer is someone in the shop itself. */
  ownShopOrders: number;
  /** Orders from buyers who paid this shop REPEAT_BUYER_THRESHOLD times or more. */
  repeatBuyerOrders: number;
}

/** The warning signs among one shop's unpaid orders; counts only, never addresses. */
export function payoutWarnings(
  orders: ReadonlyArray<{ customerEmail: string }>,
  memberEmails: readonly string[]
): PayoutWarnings {
  const members = new Set(memberEmails.map(canonicalEmail));
  const perBuyer = new Map<string, number>();
  let ownShopOrders = 0;
  for (const order of orders) {
    const buyer = canonicalEmail(order.customerEmail);
    if (members.has(buyer)) ownShopOrders++;
    perBuyer.set(buyer, (perBuyer.get(buyer) ?? 0) + 1);
  }
  let repeatBuyerOrders = 0;
  for (const count of perBuyer.values()) {
    if (count >= REPEAT_BUYER_THRESHOLD) repeatBuyerOrders += count;
  }
  return { ownShopOrders, repeatBuyerOrders };
}
