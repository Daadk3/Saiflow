/**
 * PayPal Orders v2 over plain fetch. No SDK.
 *
 *   createOrder   POST /v2/checkout/orders            (intent CAPTURE, USD)
 *   captureOrder  POST /v2/checkout/orders/{id}/capture
 *   getOrder      GET  /v2/checkout/orders/{id}
 *   verifyWebhook POST /v1/notifications/verify-webhook-signature
 *
 * Every call authenticates with a client-credentials token, cached in this
 * process until shortly before it expires. Create and capture carry a
 * PayPal-Request-Id derived from SaiFlow's merchant reference, so a retried
 * request is answered with the first result instead of a second order or a
 * second capture.
 *
 * Errors carry an HTTP status and PayPal's short error name and issue code
 * only. Never a body, a token, a URL with credentials, or the secret.
 */

import type { PayPalConfig } from "@/lib/payments/paypal/config";

const TIMEOUT_MS = 15_000;
/** Refresh the token this long before PayPal says it expires. */
const TOKEN_MARGIN_MS = 60_000;

export class PayPalError extends Error {
  readonly status: number | null;
  /** PayPal's error name, e.g. "UNPROCESSABLE_ENTITY". Short, never a message. */
  readonly paypalName: string | null;
  /** The first detail's issue code, e.g. "ORDER_ALREADY_CAPTURED". */
  readonly issue: string | null;

  constructor(status: number | null, paypalName: string | null, issue: string | null) {
    super(`PayPal request failed${status !== null ? ` (${status})` : ""}`);
    this.name = "PayPalError";
    this.status = status;
    this.paypalName = paypalName;
    this.issue = issue;
  }
}

const SHORT = /^[A-Z0-9_]{1,64}$/;
function shortCode(value: unknown): string | null {
  return typeof value === "string" && SHORT.test(value) ? value : null;
}

async function errorFrom(res: Response): Promise<PayPalError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const obj = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const details = Array.isArray(obj.details) ? obj.details : [];
  const first = (typeof details[0] === "object" && details[0] !== null ? details[0] : {}) as Record<string, unknown>;
  return new PayPalError(res.status, shortCode(obj.name) ?? shortCode(obj.error), shortCode(first.issue));
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new PayPalError(null, "NETWORK", null);
  }
}

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

/** For tests: forget the cached token. */
export function resetPayPalTokenCache(): void {
  cachedToken = null;
}

async function accessToken(config: PayPalConfig): Promise<string> {
  const key = `${config.apiBase}|${config.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await timedFetch(`${config.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw await errorFrom(res);
  const json = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!json || typeof json.access_token !== "string" || json.access_token.length === 0) {
    throw new PayPalError(res.status, "MALFORMED_TOKEN", null);
  }
  const lifetimeMs = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in * 1000 : 5 * 60_000;
  cachedToken = { key, token: json.access_token, expiresAt: Date.now() + Math.max(0, lifetimeMs - TOKEN_MARGIN_MS) };
  return json.access_token;
}

async function call(
  config: PayPalConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  requestId?: string
): Promise<unknown> {
  const token = await accessToken(config);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Prefer: "return=representation",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await timedFetch(`${config.apiBase}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw await errorFrom(res);
  const json: unknown = await res.json().catch(() => null);
  if (json === null || typeof json !== "object") throw new PayPalError(res.status, "MALFORMED_RESPONSE", null);
  return json;
}

/** PayPal order ids are short upper-case alphanumerics; refuse anything else before it reaches a URL. */
export const PAYPAL_ORDER_ID = /^[A-Z0-9]{8,32}$/;

export interface CreateOrderInput {
  /** SaiFlow's merchant reference (UUID). Sent as reference_id, custom_id and invoice_id. */
  merchantReferenceId: string;
  /** Canonical two-decimal USD, e.g. "13.07". */
  amountUsd: string;
  /** The product name, trimmed for PayPal's 127-character limit. */
  description: string;
  locale: "ar-SA" | "en-US";
}

export async function createOrder(config: PayPalConfig, input: CreateOrderInput): Promise<unknown> {
  return call(
    config,
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.merchantReferenceId,
          custom_id: input.merchantReferenceId,
          // Unique per merchant account at PayPal: a second payment for the
          // same attempt is refused by PayPal itself.
          invoice_id: input.merchantReferenceId,
          description: input.description.slice(0, 127),
          amount: { currency_code: "USD", value: input.amountUsd },
        },
      ],
      application_context: {
        brand_name: "SaiFlow",
        locale: input.locale,
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    },
    `saiflow-create-${input.merchantReferenceId}`
  );
}

export async function captureOrder(config: PayPalConfig, orderId: string, merchantReferenceId: string): Promise<unknown> {
  if (!PAYPAL_ORDER_ID.test(orderId)) throw new PayPalError(null, "INVALID_ORDER_ID", null);
  return call(
    config,
    "POST",
    `/v2/checkout/orders/${orderId}/capture`,
    {},
    `saiflow-capture-${merchantReferenceId}`
  );
}

export async function getOrder(config: PayPalConfig, orderId: string): Promise<unknown> {
  if (!PAYPAL_ORDER_ID.test(orderId)) throw new PayPalError(null, "INVALID_ORDER_ID", null);
  return call(config, "GET", `/v2/checkout/orders/${orderId}`);
}

export interface WebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

/**
 * PayPal's own verification of a webhook delivery, against OUR configured
 * PAYPAL_WEBHOOK_ID. True only when PayPal answers verification_status
 * "SUCCESS". The event is passed back exactly as it was parsed from the
 * delivered body.
 */
export async function verifyWebhookSignature(
  config: PayPalConfig,
  headers: WebhookHeaders,
  event: unknown
): Promise<boolean> {
  const json = (await call(config, "POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers.authAlgo,
    cert_url: headers.certUrl,
    transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig,
    transmission_time: headers.transmissionTime,
    webhook_id: config.webhookId,
    webhook_event: event,
  })) as { verification_status?: unknown };
  return json.verification_status === "SUCCESS";
}
