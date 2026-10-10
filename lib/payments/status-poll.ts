/**
 * Polling SaiFlow's own payment-status endpoint from the success page.
 *
 * The buyer comes back from Geidea's hosted page a moment before, or a moment
 * after, Geidea's server-to-server callback reaches SaiFlow. So the page asks
 * SaiFlow, not Geidea, and asks more than once: every `intervalMs` while the
 * answer is "processing", up to `maxAttempts`, then stops and says so. The
 * endpoint is read-only and the reference is the only thing sent, so polling
 * can neither create nor change anything; it only watches.
 *
 * Pure and injectable: `fetchImpl` and `sleep` default to the browser's, and
 * tests replace both, so every stop condition is exercised without a timer
 * or a network.
 */

import { PAYMENT_STATUSES, isMerchantReference } from "@/lib/payments/payment-status";
import type { PaymentStatus } from "@/lib/payments/payment-status";

export const DEFAULT_INTERVAL_MS = 1500;
/** About a minute at the default interval. */
export const DEFAULT_MAX_ATTEMPTS = 40;

export interface StatusResponse {
  status: PaymentStatus;
  productName: string;
  orderExists: boolean;
  /** Present only when the server has a confirmed Order: a same-origin download path. */
  downloadUrl: string | null;
}

export type PollOutcome =
  | {
      kind: "settled";
      status: Exclude<PaymentStatus, "processing">;
      productName: string;
      downloadUrl: string | null;
    }
  | { kind: "processing"; productName: string | null }
  | { kind: "unknown" }
  | { kind: "error" }
  | { kind: "aborted" };

export interface PollOptions {
  ref: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  intervalMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Called after each answer, with the attempt number and what is known so far. */
  onUpdate?: (update: { attempt: number; productName: string | null }) => void;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** A download path is accepted only as SaiFlow's own download route, relative. */
const DOWNLOAD_PATH = /^\/api\/download\/[^/?#]+\?ref=[0-9a-f-]{36}$/i;

function decode(body: unknown): StatusResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const { status, productName, orderExists, downloadUrl } = body as Record<string, unknown>;
  if (typeof status !== "string" || !(PAYMENT_STATUSES as readonly string[]).includes(status)) {
    return null;
  }
  if (typeof productName !== "string" || typeof orderExists !== "boolean") return null;
  const path =
    typeof downloadUrl === "string" && DOWNLOAD_PATH.test(downloadUrl) ? downloadUrl : null;
  return { status: status as PaymentStatus, productName, orderExists, downloadUrl: path };
}

export async function pollPaymentStatus(options: PollOptions): Promise<PollOutcome> {
  const {
    ref,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    intervalMs = DEFAULT_INTERVAL_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    signal,
    onUpdate,
  } = options;

  if (!isMerchantReference(ref)) return { kind: "unknown" };

  let productName: string | null = null;
  let answered = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return { kind: "aborted" };

    let response: Response;
    try {
      response = await fetchImpl(`/api/payment-status?ref=${encodeURIComponent(ref)}`, {
        cache: "no-store",
        signal,
      });
    } catch {
      if (signal?.aborted) return { kind: "aborted" };
      response = null as unknown as Response;
    }

    if (response !== null) {
      if (response.status === 400 || response.status === 404) return { kind: "unknown" };
      if (response.ok) {
        let decoded: StatusResponse | null = null;
        try {
          decoded = decode(await response.json());
        } catch {
          decoded = null;
        }
        if (decoded !== null) {
          answered = true;
          productName = decoded.productName;
          // "paid" is the endpoint's word, and the endpoint says it only for
          // a confirmed Order. The page shows what it is told and decides
          // nothing itself.
          if (decoded.status !== "processing") {
            return {
              kind: "settled",
              status: decoded.status,
              productName,
              // Only a paid answer may carry a download path; anything else is dropped.
              downloadUrl: decoded.status === "paid" ? decoded.downloadUrl : null,
            };
          }
        }
      }
      // Any other answer is transient: a 429, a 5xx, a body that did not
      // decode. The loop simply tries again until the budget runs out.
    }

    onUpdate?.({ attempt, productName });
    if (attempt < maxAttempts) {
      await sleep(intervalMs, signal);
      if (signal?.aborted) return { kind: "aborted" };
    }
  }

  return answered ? { kind: "processing", productName } : { kind: "error" };
}
