import { env } from "@/lib/env";

/**
 * PayPal configuration, read once per call from lib/env. Fails closed: when
 * any credential or PAYPAL_ENV is missing, or the fixed rate is unreadable,
 * PayPal is simply not configured. The checkout page then hides the button
 * and both PayPal routes refuse, exactly as checkout behaves for an
 * unconfigured Geidea.
 *
 * "sandbox" is PayPal's test account and is treated like a Geidea test
 * account. "live" is treated like a production Geidea account: the same
 * LIVE_PAYMENTS_MODE gates and production-deployment check apply
 * (lib/payments/live-mode).
 */

export type PayPalEnv = "sandbox" | "live";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  env: PayPalEnv;
  apiBase: string;
  /** SAR per 1 USD, as a canonical string with up to four decimals ("3.75"). */
  sarPerUsd: string;
}

export const DEFAULT_SAR_PER_USD = "3.75";

const API_BASE: Record<PayPalEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

/** A positive decimal with at most four places, or null. Missing means the default. */
export function parseSarPerUsd(raw: unknown): string | null {
  if (raw === undefined || raw === null) return DEFAULT_SAR_PER_USD;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return DEFAULT_SAR_PER_USD;
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(value)) return null;
  if (Number(value) <= 0) return null;
  return value;
}

export function payPalConfig(): PayPalConfig | null {
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  const mode = env.PAYPAL_ENV;
  if (!clientId || !clientSecret || !webhookId) return null;
  if (mode !== "sandbox" && mode !== "live") return null;
  const sarPerUsd = parseSarPerUsd(env.PAYPAL_SAR_PER_USD);
  if (sarPerUsd === null) return null;
  return { clientId, clientSecret, webhookId, env: mode, apiBase: API_BASE[mode], sarPerUsd };
}

export function isPayPalConfigured(): boolean {
  return payPalConfig() !== null;
}

/** Which account kind this is, in lib/payments/live-mode's terms. */
export function payPalAccount(mode: PayPalEnv): "test" | "production" {
  return mode === "live" ? "production" : "test";
}

/** The PaymentSession/Order environment column for this PayPal account. */
export function payPalEnvironment(mode: PayPalEnv): "TEST" | "PRODUCTION" {
  return mode === "live" ? "PRODUCTION" : "TEST";
}
