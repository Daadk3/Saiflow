/**
 * The gates a PayPal checkout passes before any money is involved.
 *
 * The same gates, in the same order, as the Geidea checkout route
 * (app/api/checkout/route.ts), which is deliberately left untouched:
 * pre-launch and founder access, a real product, moderation and shop
 * visibility, hosted-access readiness or the two file-safety gates, the SAR
 * price and currency, the founder-test cap, and which provider account this
 * deployment may use (lib/payments/live-mode). Then the PayPal-specific
 * parts: PayPal configured, and the SAR price convertible to USD.
 *
 * Nothing the browser sends decides anything here except which product.
 */

import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isDeliverableSafe } from "@/lib/file-safety";
import { extrasAreSafe } from "@/lib/product-deliverables";
import { hostedAccessReady } from "@/lib/hosted-access/validate";
import { unsellableReason } from "@/lib/sellable";
import { canonicalAmount } from "@/lib/payments/geidea/callback";
import { accountAllowed, productionAccountHere, withinFounderCap } from "@/lib/payments/live-mode";
import { currentCheckoutAccess } from "@/lib/payments/request-access";
import { payPalAccount, payPalConfig, payPalEnvironment, type PayPalConfig } from "@/lib/payments/paypal/config";
import { sarToUsd } from "@/lib/payments/paypal/convert";

export type Refusal = { status: number; body: Record<string, unknown>; reason: string };

/** Pre-launch, founder access and PayPal's account gate. Shared by create and capture. */
export async function payPalAccessGate(): Promise<
  | { ok: true; config: PayPalConfig; founderTest: boolean; environment: "TEST" | "PRODUCTION" }
  | { ok: false; refusal: Refusal }
> {
  const { access, mode } = await currentCheckoutAccess();
  if ((env.PRE_LAUNCH_MODE && access.kind !== "founder_test") || access.kind === "closed") {
    return {
      ok: false,
      refusal: {
        status: 503,
        body: { error: "pre_launch", message: "Saiflow is in pre-launch. Payments are not yet available." },
        reason: "pre_launch",
      },
    };
  }
  const config = payPalConfig();
  if (config === null) {
    return {
      ok: false,
      refusal: { status: 503, body: { error: "paypal_unavailable" }, reason: "not_configured" },
    };
  }
  const account = payPalAccount(config.env);
  if (
    !accountAllowed(access, mode, account) ||
    (account === "production" && !productionAccountHere(process.env.VERCEL_ENV))
  ) {
    return {
      ok: false,
      refusal: { status: 503, body: { error: "paypal_unavailable" }, reason: "live_paypal_not_allowed" },
    };
  }
  return { ok: true, config, founderTest: access.kind === "founder_test", environment: payPalEnvironment(config.env) };
}

const NOT_AVAILABLE: Refusal = {
  status: 400,
  body: { error: "not_available", message: "This product is not available for purchase." },
  reason: "not_available",
};

export interface SellableForPayPal {
  id: string;
  name: string;
  price: unknown;
  amountSar: string;
  amountUsd: string;
}

/** The product, if it may be sold right now, with its SAR and USD amounts. */
export async function payPalSellable(
  productId: string,
  founderTest: boolean,
  sarPerUsd: string
): Promise<{ ok: true; product: SellableForPayPal } | { ok: false; refusal: Refusal }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      shop: true,
      hostedAccess: { select: { accessUrl: true, instructions: true } },
      deliverables: {
        orderBy: { position: "asc" },
        select: { fileKey: true, fileScanStatus: true, fileScanKey: true },
      },
    },
  });
  if (!product) return { ok: false, refusal: { status: 404, body: { error: "Product not found" }, reason: "not_found" } };

  const availability = unsellableReason(product);
  if (
    availability === "inactive" ||
    availability === "not_approved" ||
    availability === "shop_inactive" ||
    availability === "sales_disabled"
  ) {
    return { ok: false, refusal: NOT_AVAILABLE };
  }

  const hosted = product.deliveryType === "HOSTED_ACCESS";
  if (hosted) {
    if (!Array.isArray(product.deliverables) || product.deliverables.length > 0) return { ok: false, refusal: NOT_AVAILABLE };
    if (!hostedAccessReady(product.hostedAccess)) return { ok: false, refusal: NOT_AVAILABLE };
  } else {
    if (!product.fileUrl) return { ok: false, refusal: NOT_AVAILABLE };
    const fileNotReady: Refusal = {
      status: 400,
      body: { error: "file_not_ready", message: "This product is not available for purchase. Its file has not completed safety checks." },
      reason: "file_not_ready",
    };
    if (!isDeliverableSafe(product)) return { ok: false, refusal: fileNotReady };
    if (!Array.isArray(product.deliverables) || !extrasAreSafe(product.deliverables)) return { ok: false, refusal: fileNotReady };
  }

  const amountSar = canonicalAmount(product.price);
  if (founderTest && amountSar !== null && !withinFounderCap(amountSar)) {
    return { ok: false, refusal: { status: 400, body: { error: "founder_test_amount" }, reason: "founder_test_amount" } };
  }
  if (amountSar === null || product.currency !== "SAR") return { ok: false, refusal: { ...NOT_AVAILABLE, reason: "price_or_currency" } };
  const amountUsd = sarToUsd(amountSar, sarPerUsd);
  if (amountUsd === null) return { ok: false, refusal: { ...NOT_AVAILABLE, reason: "conversion" } };

  return { ok: true, product: { id: product.id, name: product.name, price: product.price, amountSar, amountUsd } };
}
