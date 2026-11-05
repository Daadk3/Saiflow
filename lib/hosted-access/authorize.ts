/**
 * Who may see a hosted-access product's private link, decided fresh on every
 * request.
 *
 * PROOF OF PURCHASE IS AN ORDER ROW, never a PaymentSession. Orders are
 * written only after a signature-verified provider confirmation (see the
 * Order model), so this module looks the Order up on every call and decides
 * from that row alone. Nothing here reads PaymentSession, and no answer is
 * cached: refresh the page after a refund-and-delete or a rejection and the
 * access is gone.
 *
 * The caller must hold one credential, exactly as the download route asks:
 *
 *   ref       ?ref=<merchantReferenceId>   the success page, 7 days from the order
 *   receipt   ?t=<signed token>            the receipt email, 7 days from sending
 *   account   ?purchase=<Order id>         signed in with the address bought with
 *   admin     ?purchase=<Order id>         a signed-in marketplace admin
 *
 * Each one names a single Order, and that Order must be for THIS product. More
 * than one credential at once is refused rather than resolved.
 *
 * Then, from the rows, every time:
 *   - the product is still a HOSTED_ACCESS product, still APPROVED, and its
 *     shop is still active (pending or rejected products deliver nothing);
 *   - its stored link still passes validateHostedUrl (fail closed on a rule
 *     tightened after it was saved);
 *   - the Order's payment environment matches this deployment: a PRODUCTION
 *     order is honoured only by the production deployment, and a TEST order
 *     only outside it. So a Preview that can reach production data, or a
 *     production deployment pointed at Geidea's test account, can never turn
 *     a payment into real hosted access.
 *
 * Pure: every lookup is injected, which is what lets the tests drive it with
 * synthetic rows only. lib/hosted-access/server wires it to Prisma.
 */

import { verifyReceiptToken, withinReceiptWindow } from "@/lib/download-links";
import { isMerchantReference } from "@/lib/payments/payment-status";
import { validateAccessInstructions, validateHostedUrl } from "@/lib/hosted-access/validate";

export interface HostedOrderRow {
  id: string;
  productId: string;
  customerEmail: string;
  paymentProvider: "STRIPE" | "GEIDEA";
  paymentEnvironment: "TEST" | "PRODUCTION";
  createdAt: Date;
}

export interface HostedProductRow {
  id: string;
  name: string;
  deliveryType: "FILE" | "HOSTED_ACCESS";
  moderationStatus: "PENDING" | "APPROVED" | "REJECTED";
  shop: { isActive: boolean; name: string };
  hostedAccess: { accessUrl: string; instructions: string | null } | null;
}

export interface HostedAccessDeps {
  findOrderByMerchantReference(ref: string): Promise<HostedOrderRow | null>;
  findOrderById(id: string): Promise<HostedOrderRow | null>;
  findProduct(id: string): Promise<HostedProductRow | null>;
  /** The signed-in user's verified address, lower-cased, or null. */
  sessionEmail(): Promise<string | null>;
  isAdmin(email: string): boolean;
  /** Vercel's own VERCEL_ENV for this process. */
  vercelEnv: string | undefined;
  receiptSecret: string | undefined;
  now?: Date;
}

export interface HostedAccessCredentials {
  productId: string;
  ref?: string | null;
  token?: string | null;
  purchase?: string | null;
}

export type HostedAccessDecision =
  | {
      ok: true;
      channel: "ref" | "receipt" | "account" | "admin";
      productName: string;
      shopName: string;
      orderId: string;
      accessUrl: string;
      instructions: string | null;
      testOrder: boolean;
    }
  | { ok: false; reason: "no_credential" | "ambiguous" | "expired" | "not_authorized" | "unavailable" | "wrong_environment" };

const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether this deployment may honour an order taken in `environment`. */
export function environmentHonoured(environment: "TEST" | "PRODUCTION", vercelEnv: string | undefined): boolean {
  const productionHere = vercelEnv === "production";
  return environment === "PRODUCTION" ? productionHere : !productionHere;
}

export async function authorizeHostedAccess(
  credentials: HostedAccessCredentials,
  deps: HostedAccessDeps
): Promise<HostedAccessDecision> {
  const { productId } = credentials;
  const ref = credentials.ref ?? null;
  const token = credentials.token ?? null;
  const purchase = credentials.purchase ?? null;
  const now = deps.now ?? new Date();

  if (typeof productId !== "string" || !ORDER_ID.test(productId)) return { ok: false, reason: "not_authorized" };
  const given = [ref, token, purchase].filter((v) => v !== null && v !== "").length;
  if (given === 0) return { ok: false, reason: "no_credential" };
  if (given > 1) return { ok: false, reason: "ambiguous" };

  let order: HostedOrderRow | null = null;
  let channel: "ref" | "receipt" | "account" | "admin";

  if (ref) {
    channel = "ref";
    if (!isMerchantReference(ref)) return { ok: false, reason: "not_authorized" };
    const found = await deps.findOrderByMerchantReference(ref);
    if (!found || found.paymentProvider !== "GEIDEA" || found.productId !== productId) {
      return { ok: false, reason: "not_authorized" };
    }
    if (!withinReceiptWindow(found.createdAt, now)) return { ok: false, reason: "expired" };
    order = found;
  } else if (token) {
    channel = "receipt";
    const check = verifyReceiptToken(token, productId, deps.receiptSecret, now);
    if (!check.ok) return { ok: false, reason: check.reason === "expired" ? "expired" : "not_authorized" };
    const found = await deps.findOrderById(check.orderId);
    if (!found || found.productId !== productId) return { ok: false, reason: "not_authorized" };
    order = found;
  } else {
    if (!purchase || !ORDER_ID.test(purchase)) return { ok: false, reason: "not_authorized" };
    const email = await deps.sessionEmail();
    if (!email) return { ok: false, reason: "not_authorized" };
    const found = await deps.findOrderById(purchase);
    if (!found || found.productId !== productId) return { ok: false, reason: "not_authorized" };
    if (found.customerEmail.trim().toLowerCase() === email) {
      channel = "account";
    } else if (deps.isAdmin(email)) {
      channel = "admin";
    } else {
      return { ok: false, reason: "not_authorized" };
    }
    order = found;
  }

  if (!environmentHonoured(order.paymentEnvironment, deps.vercelEnv)) {
    return { ok: false, reason: "wrong_environment" };
  }

  const product = await deps.findProduct(order.productId);
  if (
    !product ||
    product.id !== productId ||
    product.deliveryType !== "HOSTED_ACCESS" ||
    product.moderationStatus !== "APPROVED" ||
    !product.shop.isActive ||
    !product.hostedAccess
  ) {
    return { ok: false, reason: "unavailable" };
  }

  const url = validateHostedUrl(product.hostedAccess.accessUrl);
  const instructions = validateAccessInstructions(product.hostedAccess.instructions);
  if (!url.ok || !instructions.ok) return { ok: false, reason: "unavailable" };

  return {
    ok: true,
    channel,
    productName: product.name,
    shopName: product.shop.name,
    orderId: order.id,
    accessUrl: url.value,
    instructions: instructions.value,
    testOrder: order.paymentEnvironment !== "PRODUCTION",
  };
}

/** The buyer's delivery page for one order, as a same-origin path. */
export function hostedAccessPath(productId: string, credential: { ref: string } | { token: string } | { purchase: string }): string {
  const base = `/access/${encodeURIComponent(productId)}`;
  if ("ref" in credential) return `${base}?ref=${encodeURIComponent(credential.ref)}`;
  if ("token" in credential) return `${base}?t=${encodeURIComponent(credential.token)}`;
  return `${base}?purchase=${encodeURIComponent(credential.purchase)}`;
}
