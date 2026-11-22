/**
 * PayPal checkout, without PayPal.
 *
 * The real create-order, capture and webhook handlers run against real
 * Requests. Prisma, the env module, the email and notify modules and the
 * PayPal REST client are doubles: the client records what it was asked and
 * answers canned PayPal orders; global fetch throws, so nothing can leave
 * the process. lib/payments/paypal/{gate,verify,fulfil,convert,config} are
 * the real modules.
 *
 * Covers: create (attempt first, USD conversion, gates), capture (Order
 * only after a verified COMPLETED capture), a duplicate webhook (one Order,
 * one receipt), and an amount mismatch (no Order, attempt untouched).
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const KEY = "abc123XY_key-one";
const PAYPAL_ORDER = "5O190127TN364715T";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class FakeDecimal {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

type Row = Record<string, unknown> & { id: string };

const db: { product: Row | null; sessions: Row[]; orders: Row[] } = { product: null, sessions: [], orders: [] };
const emails: Record<string, unknown>[] = [];
const notifications: Record<string, unknown>[] = [];
const paypalCalls: { op: string; args: unknown[] }[] = [];
const logs: string[] = [];

const state = {
  preLaunch: false,
  liveMode: undefined as string | undefined,
  paypalEnv: "sandbox" as string | undefined,
  clientId: "sandbox-client-id" as string | undefined,
  rate: undefined as string | undefined,
  /** What PayPal answers to capture / GET for the order. */
  paypalOrder: null as null | ((orderId: string) => unknown),
  captureError: null as Error | null,
  verifyOk: true,
};

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Record<string, unknown>[]).some((w) => matches(row, w));
    if (v !== null && typeof v === "object" && "not" in (v as object)) return (row[k] ?? null) !== (v as { not: unknown }).not;
    return (row[k] ?? null) === v;
  });
}

function pick(row: Row, select?: Record<string, unknown>): Row {
  if (!select) return { ...row };
  const out: Row = { id: row.id };
  for (const key of Object.keys(select)) out[key] = row[key] ?? null;
  return out;
}

const fake = {
  product: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      if (!db.product || db.product.id !== where.id) return null;
      return { deliverables: [], hostedAccess: null, deliveryType: "FILE", ...db.product };
    },
    // Read at import time by lib/file-safety's SAFE_DELIVERABLE_WHERE.
    fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
  },
  paymentSession: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: Row = { id: `ps_${db.sessions.length + 1}`, createdAt: new Date(), ...data };
      db.sessions.push(row);
      return { id: row.id };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of db.sessions) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    },
    findUnique: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const compound = where.provider_providerOrderId as { provider: string; providerOrderId: string } | undefined;
      const row = compound
        ? db.sessions.find((s) => s.provider === compound.provider && s.providerOrderId === compound.providerOrderId)
        : db.sessions.find((s) => s.merchantReferenceId === where.merchantReferenceId);
      return row ? pick(row, select) : null;
    },
  },
  order: {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      const row = db.orders.find((o) => matches(o, where));
      return row ? { id: row.id } : null;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const row = db.orders.find((o) => matches(o, where));
      return row ? { id: row.id } : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      // The two unique indexes on Order.
      if (
        db.orders.some(
          (o) =>
            o.merchantReferenceId === data.merchantReferenceId ||
            (o.paymentProvider === data.paymentProvider && o.providerOrderId === data.providerOrderId)
        )
      ) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row: Row = { id: `ord_${db.orders.length + 1}`, ...data };
      db.orders.push(row);
      return { id: row.id };
    },
  },
  // Transactions run one at a time: Postgres holds the claimed row's lock
  // until commit, so a second claim waits and then sees PAID.
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const previous = txQueue;
    let release!: () => void;
    txQueue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await runTransaction(fn);
    } finally {
      release();
    }
  },
};

let txQueue: Promise<void> = Promise.resolve();

async function runTransaction(fn: (tx: unknown) => Promise<unknown>) {
  {
    const snapshot = { sessions: db.sessions.map((s) => ({ ...s })), orders: db.orders.map((o) => ({ ...o })) };
    try {
      return await fn(fake);
    } catch (error) {
      db.sessions = snapshot.sessions;
      db.orders = snapshot.orders;
      throw error;
    }
  }
}

class PayPalError extends Error {
  readonly status: number | null;
  readonly paypalName: string | null;
  readonly issue: string | null;
  constructor(status: number | null, paypalName: string | null, issue: string | null) {
    super("PayPal request failed");
    this.name = "PayPalError";
    this.status = status;
    this.paypalName = paypalName;
    this.issue = issue;
  }
}

/** A PayPal order as the Orders v2 API returns it after capture. */
function paypalOrder(opts: { ref: string; value?: string; currency?: string; status?: string; captureStatus?: string; id?: string }) {
  return {
    id: opts.id ?? PAYPAL_ORDER,
    status: opts.status ?? "COMPLETED",
    purchase_units: [
      {
        reference_id: opts.ref,
        custom_id: opts.ref,
        payments: {
          captures: [
            {
              id: "3C679366HH908993F",
              status: opts.captureStatus ?? "COMPLETED",
              amount: { currency_code: opts.currency ?? "USD", value: opts.value ?? "13.07" },
            },
          ],
        },
      },
    ],
  };
}

let createOrderPOST: (req: Request) => Promise<Response>;
let capturePOST: (req: Request) => Promise<Response>;
let webhookPOST: (req: Request) => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: fake } });
  mock.module("@/lib/env", {
    namedExports: {
      env: {
        get PRE_LAUNCH_MODE() {
          return state.preLaunch;
        },
        get LIVE_PAYMENTS_MODE() {
          return state.liveMode;
        },
        get PAYPAL_CLIENT_ID() {
          return state.clientId;
        },
        PAYPAL_CLIENT_SECRET: "sandbox-secret-not-real",
        PAYPAL_WEBHOOK_ID: "WH-TEST-1",
        get PAYPAL_ENV() {
          return state.paypalEnv;
        },
        get PAYPAL_SAR_PER_USD() {
          return state.rate;
        },
        NEXTAUTH_URL: "https://saiflow.test",
        NEXTAUTH_SECRET: "test-secret-for-receipts-only-000000000000",
      },
    },
  });
  mock.module("@/lib/email", {
    namedExports: {
      sendPurchaseEmail: async (args: Record<string, unknown>) => {
        emails.push(args);
      },
    },
  });
  mock.module("@/lib/notify", {
    namedExports: {
      notifySaleFulfilled: async (args: Record<string, unknown>) => {
        notifications.push(args);
      },
      // Imported by lib/file-safety; never reached by a checkout.
      notifyAdminsProductReadyForReview: async () => undefined,
    },
  });
  mock.module("@/lib/payments/paypal/client", {
    namedExports: {
      PayPalError,
      PAYPAL_ORDER_ID: /^[A-Z0-9]{8,32}$/,
      createOrder: async (config: unknown, input: Record<string, unknown>) => {
        paypalCalls.push({ op: "createOrder", args: [config, input] });
        return { id: PAYPAL_ORDER, status: "CREATED", purchase_units: [{ reference_id: input.merchantReferenceId }] };
      },
      captureOrder: async (config: unknown, orderId: string, ref: string) => {
        paypalCalls.push({ op: "captureOrder", args: [config, orderId, ref] });
        if (state.captureError) throw state.captureError;
        if (!state.paypalOrder) throw new Error("test gave no PayPal order");
        return state.paypalOrder(orderId);
      },
      getOrder: async (config: unknown, orderId: string) => {
        paypalCalls.push({ op: "getOrder", args: [config, orderId] });
        if (!state.paypalOrder) throw new Error("test gave no PayPal order");
        return state.paypalOrder(orderId);
      },
      verifyWebhookSignature: async (config: unknown, headers: unknown, event: unknown) => {
        paypalCalls.push({ op: "verifyWebhookSignature", args: [config, headers, event] });
        return state.verifyOk;
      },
    },
  });
  globalThis.fetch = (async () => {
    throw new Error("network access is not permitted in tests");
  }) as typeof fetch;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  }
  createOrderPOST = (await import("../app/api/paypal/create-order/route.ts")).POST as typeof createOrderPOST;
  capturePOST = (await import("../app/api/paypal/capture/route.ts")).POST as typeof capturePOST;
  webhookPOST = (await import("../app/api/webhooks/paypal/route.ts")).POST as typeof webhookPOST;
});

function product(over: Record<string, unknown> = {}): Row {
  return {
    id: "prod_1",
    name: "Arabic Templates Pack",
    price: new FakeDecimal("49.00"),
    currency: "SAR",
    slug: "arabic-templates-pack",
    isActive: true,
    moderationStatus: "APPROVED",
    fileUrl: "https://app.ufs.sh/f/abc123XY_key-one",
    fileKey: KEY,
    fileScanStatus: "SAFE",
    fileScanKey: KEY,
    shop: { isActive: true, salesEnabled: true, slug: "my-shop" },
    ...over,
  };
}

beforeEach(() => {
  db.product = product();
  db.sessions = [];
  db.orders = [];
  emails.length = 0;
  notifications.length = 0;
  paypalCalls.length = 0;
  logs.length = 0;
  state.preLaunch = false;
  state.liveMode = undefined;
  state.paypalEnv = "sandbox";
  state.clientId = "sandbox-client-id";
  state.rate = undefined;
  state.paypalOrder = null;
  state.captureError = null;
  state.verifyOk = true;
});

let ip = 0;
function post(handler: (req: Request) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) {
  ip++;
  return handler(
    new Request(`https://saiflow.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `10.77.${(ip >> 8) & 255}.${ip & 255}`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

async function createOrder(body: unknown = { productId: "prod_1", buyerEmail: "buyer@example.com", buyerName: "Test Buyer" }) {
  const res = await post(createOrderPOST, "/api/paypal/create-order", body);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function capture(orderId = PAYPAL_ORDER) {
  const res = await post(capturePOST, "/api/paypal/capture", { orderId });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const WEBHOOK_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270",
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "paypal-transmission-sig": "c2lnbmF0dXJlLW5vdC1yZWFs",
  "paypal-transmission-time": "2026-11-22T20:00:00Z",
};

function captureEvent(ref: string, orderId = PAYPAL_ORDER) {
  return {
    id: "WH-58D329510W468432D-8HN650336L201105X",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "3C679366HH908993F",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "13.07" },
      custom_id: ref,
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  };
}

async function webhook(event: unknown, headers: Record<string, string> = WEBHOOK_HEADERS) {
  const res = await post(webhookPOST, "/api/webhooks/paypal", event, headers);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** A created attempt, ready to be captured. */
async function createdAttempt(): Promise<Row> {
  const res = await createOrder();
  assert.equal(res.status, 200);
  return db.sessions[0];
}

/* ------------------------------------------------------------------ */

describe("create order", () => {
  test("records the attempt before asking PayPal, in SAR with the USD charge beside it", async () => {
    const res = await createOrder();
    assert.equal(res.status, 200);
    assert.equal(res.body.orderId, PAYPAL_ORDER);
    assert.equal(res.body.amountUsd, "13.07");
    assert.equal(res.body.currency, "USD");

    assert.equal(db.sessions.length, 1);
    const s = db.sessions[0];
    assert.equal(s.provider, "PAYPAL");
    assert.equal(s.amount, "49.00");
    assert.equal(s.currency, "SAR");
    assert.equal(s.chargeAmount, "13.07");
    assert.equal(s.chargeCurrency, "USD");
    assert.equal(s.chargeRate, "3.75");
    assert.equal(s.environment, "TEST");
    assert.equal(s.status, "SESSION_CREATED");
    assert.equal(s.providerOrderId, PAYPAL_ORDER);
    assert.equal(s.currentAttemptKey ?? null, null, "a PayPal attempt never holds Geidea's per-browser slot");
    assert.match(String(s.merchantReferenceId), UUID_V4);
    assert.equal(res.body.statusPath, `/success?ref=${s.merchantReferenceId}`);

    const call = paypalCalls.find((c) => c.op === "createOrder");
    assert.ok(call);
    const [config, input] = call.args as [Record<string, unknown>, Record<string, unknown>];
    assert.equal(config.env, "sandbox");
    assert.equal(config.apiBase, "https://api-m.sandbox.paypal.com");
    assert.equal(input.amountUsd, "13.07");
    assert.equal(input.merchantReferenceId, s.merchantReferenceId);
    assert.equal(db.orders.length, 0, "creating a PayPal order never creates an Order");
  });

  test("uses PAYPAL_SAR_PER_USD when set", async () => {
    state.rate = "3.80";
    const res = await createOrder();
    assert.equal(res.body.amountUsd, "12.89");
    assert.equal(db.sessions[0].chargeRate, "3.80");
  });

  test("the browser cannot set the amount, currency or rate", async () => {
    const res = await createOrder({
      productId: "prod_1",
      buyerEmail: "buyer@example.com",
      buyerName: "Test Buyer",
      amount: "0.01",
      amountUsd: "0.01",
      currency: "USD",
      rate: "1000",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.amountUsd, "13.07");
    assert.equal(db.sessions[0].amount, "49.00");
  });

  test("pre-launch refuses before anything is read or written", async () => {
    state.preLaunch = true;
    const res = await createOrder();
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "pre_launch");
    assert.equal(db.sessions.length, 0);
    assert.equal(paypalCalls.length, 0);
  });

  test("unconfigured PayPal refuses", async () => {
    state.clientId = undefined;
    const res = await createOrder();
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "paypal_unavailable");
    assert.equal(db.sessions.length, 0);
  });

  test("a live PayPal account follows the production-account gate (refused unless LIVE_PAYMENTS_MODE allows it)", async () => {
    state.paypalEnv = "live";
    const res = await createOrder();
    assert.equal(res.status, 503);
    assert.equal(db.sessions.length, 0);
    assert.equal(paypalCalls.length, 0);
  });

  test("an unapproved product is refused with nothing recorded", async () => {
    db.product = product({ moderationStatus: "PENDING" });
    const res = await createOrder();
    assert.equal(res.status, 400);
    assert.equal(db.sessions.length, 0);
    assert.equal(paypalCalls.length, 0);
  });

  test("an invalid email is refused", async () => {
    const res = await createOrder({ productId: "prod_1", buyerEmail: "nope", buyerName: "Test Buyer" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_email");
    assert.equal(db.sessions.length, 0);
  });
});

describe("capture", () => {
  test("a verified COMPLETED capture creates exactly one Order, in SAR, and sends one receipt", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    const res = await capture();
    assert.equal(res.status, 200);
    assert.equal(res.body.result, "paid");
    assert.equal(res.body.statusPath, `/success?ref=${s.merchantReferenceId}`);

    assert.equal(db.orders.length, 1);
    const order = db.orders[0];
    assert.equal(order.paymentProvider, "PAYPAL");
    assert.equal(order.providerOrderId, PAYPAL_ORDER);
    assert.equal(order.merchantReferenceId, s.merchantReferenceId);
    assert.equal(order.price, "49.00");
    assert.equal(order.currency, "SAR");
    assert.equal(order.paymentEnvironment, "TEST");
    assert.equal(order.customerEmail, "buyer@example.com");
    assert.equal(db.sessions[0].status, "PAID");
    assert.equal(emails.length, 1);
    assert.equal(notifications.length, 1);
  });

  test("capturing again is answered from the existing Order without calling PayPal", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    await capture();
    paypalCalls.length = 0;
    const res = await capture();
    assert.equal(res.status, 200);
    assert.equal(res.body.result, "paid");
    assert.equal(db.orders.length, 1);
    assert.equal(emails.length, 1);
    assert.equal(paypalCalls.length, 0);
  });

  test("an amount mismatch creates no Order and leaves the attempt untouched", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId), value: "1.00" });
    const res = await capture();
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "mismatch");
    assert.equal(db.orders.length, 0);
    assert.equal(db.sessions[0].status, "SESSION_CREATED");
    assert.equal(emails.length, 0);
    assert.ok(logs.some((l) => l.includes("mismatch:amount")));
  });

  test("a currency mismatch creates no Order", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId), currency: "EUR" });
    const res = await capture();
    assert.equal(res.status, 409);
    assert.equal(db.orders.length, 0);
  });

  test("another merchant reference creates no Order", async () => {
    await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: "00000000-0000-4000-8000-000000000000" });
    const res = await capture();
    assert.equal(res.status, 409);
    assert.equal(db.orders.length, 0);
  });

  test("a capture that is not COMPLETED creates no Order", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () =>
      paypalOrder({ ref: String(s.merchantReferenceId), status: "COMPLETED", captureStatus: "PENDING" });
    const res = await capture();
    assert.equal(res.status, 202);
    assert.equal(res.body.result, "pending");
    assert.equal(db.orders.length, 0);
    assert.notEqual(db.sessions[0].status, "PAID");
  });

  test("a declined capture closes the attempt as FAILED with no Order", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () =>
      paypalOrder({ ref: String(s.merchantReferenceId), status: "APPROVED", captureStatus: "DECLINED" });
    const res = await capture();
    assert.equal(res.status, 402);
    assert.equal(db.orders.length, 0);
    assert.equal(db.sessions[0].status, "FAILED");
  });

  test("an order id SaiFlow never created is refused", async () => {
    const res = await capture("9X999999999999999");
    assert.equal(res.status, 404);
    assert.equal(db.orders.length, 0);
  });

  test("a malformed order id never reaches PayPal", async () => {
    const res = await capture("../../v1/oauth2");
    assert.equal(res.status, 400);
    assert.equal(paypalCalls.length, 0);
  });

  test("ORDER_ALREADY_CAPTURED is verified through a GET and still yields one Order", async () => {
    const s = await createdAttempt();
    state.captureError = new PayPalError(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED");
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    const res = await capture();
    assert.equal(res.status, 200);
    assert.ok(paypalCalls.some((c) => c.op === "getOrder"));
    assert.equal(db.orders.length, 1);
  });
});

describe("webhook", () => {
  test("PAYMENT.CAPTURE.COMPLETED creates the Order after PayPal verifies the signature and the order", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    const res = await webhook(captureEvent(String(s.merchantReferenceId)));
    assert.equal(res.status, 200);
    assert.equal(res.body.result, "fulfilled");
    assert.equal(db.orders.length, 1);
    const verify = paypalCalls.find((c) => c.op === "verifyWebhookSignature");
    assert.ok(verify);
    assert.equal((verify.args[0] as { webhookId: string }).webhookId, "WH-TEST-1");
  });

  test("a duplicate webhook never creates a second Order or a second receipt", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    const event = captureEvent(String(s.merchantReferenceId));
    const first = await webhook(event);
    const second = await webhook(event);
    const third = await webhook(event);
    assert.equal(first.body.result, "fulfilled");
    assert.equal(second.status, 200);
    assert.equal(second.body.result, "already_fulfilled");
    assert.equal(third.body.result, "already_fulfilled");
    assert.equal(db.orders.length, 1);
    assert.equal(emails.length, 1);
    assert.equal(notifications.length, 1);
  });

  test("the webhook after the capture route already fulfilled is a no-op", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    await capture();
    const res = await webhook(captureEvent(String(s.merchantReferenceId)));
    assert.equal(res.body.result, "already_fulfilled");
    assert.equal(db.orders.length, 1);
    assert.equal(emails.length, 1);
  });

  test("two deliveries racing still produce one Order", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    const event = captureEvent(String(s.merchantReferenceId));
    const results = await Promise.all([webhook(event), webhook(event), capture()]);
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results));
    assert.equal(db.orders.length, 1);
    assert.equal(emails.length, 1);
  });

  test("an unverified signature is refused before the database is read", async () => {
    const s = await createdAttempt();
    state.verifyOk = false;
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    const res = await webhook(captureEvent(String(s.merchantReferenceId)));
    assert.equal(res.status, 400);
    assert.equal(db.orders.length, 0);
    assert.ok(!paypalCalls.some((c) => c.op === "getOrder"));
  });

  test("missing transmission headers are refused without asking PayPal", async () => {
    const s = await createdAttempt();
    paypalCalls.length = 0;
    const res = await webhook(captureEvent(String(s.merchantReferenceId)), {});
    assert.equal(res.status, 400);
    assert.equal(paypalCalls.length, 0);
  });

  test("an amount mismatch in PayPal's order creates no Order", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId), value: "0.50" });
    const res = await webhook(captureEvent(String(s.merchantReferenceId)));
    assert.equal(res.status, 409);
    assert.equal(db.orders.length, 0);
    assert.equal(db.sessions[0].status, "SESSION_CREATED");
  });

  test("other event types are acknowledged and ignored", async () => {
    await createdAttempt();
    const res = await webhook({ id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.result, "ignored");
    assert.equal(db.orders.length, 0);
  });

  test("a capture for an order SaiFlow never created is acknowledged and creates nothing", async () => {
    state.paypalOrder = () => paypalOrder({ ref: "00000000-0000-4000-8000-000000000000", id: "8AB12345CD6789012" });
    const res = await webhook(captureEvent("00000000-0000-4000-8000-000000000000", "8AB12345CD6789012"));
    assert.equal(res.status, 200);
    assert.equal(res.body.result, "unknown_order");
    assert.equal(db.orders.length, 0);
  });
});

describe("no secret reaches a log or a response", () => {
  test("the client secret and full merchant reference never appear in logs", async () => {
    const s = await createdAttempt();
    state.paypalOrder = () => paypalOrder({ ref: String(s.merchantReferenceId) });
    await capture();
    const all = logs.join("\n");
    assert.ok(!all.includes("sandbox-secret-not-real"));
    assert.ok(!all.includes(String(s.merchantReferenceId)));
  });
});
