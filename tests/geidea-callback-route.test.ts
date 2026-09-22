/**
 * Geidea callback route: the handler, end to end, without a network or a
 * database, driven by the shape Geidea actually sends.
 *
 * Every callback body is a redacted, structurally faithful copy of a real
 * test callback captured on 21 September 2026: top-level `order`,
 * `signature`, `timeStamp`, `sessionId`; response codes on each transaction;
 * order status "Success" with detailed status "Paid". Each body is signed for
 * real with the fixture password, so the route's verification is the real
 * verifier on real HMACs. Each body also carries what a real callback carries
 * and this route must never keep: a masked card number, a cardholder name, a
 * card token, a 3DS token, Geidea's copy of the public key. The last suite
 * scans every log line, every write and every response for them.
 *
 * Prisma is replaced by an in-memory fake that honours the two things the
 * route relies on: conditional `updateMany` (the claim) and the Order's
 * unique constraints, which throw Prisma's P2002 on a duplicate. Its
 * `$transaction` snapshots state and restores it when the callback throws.
 * The env, the receipt sender and the Geidea client are replaced too;
 * `getOrder` is a recorder that answers a canned inquiry or throws. Global
 * fetch throws, so nothing can leave the process.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signCallback } from "../lib/payments/geidea/signature.ts";

/* ------------------------------------------------------------------ */
/* Fixtures — none of these is a real credential                       */
/* ------------------------------------------------------------------ */

const PK = "d1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b";
const PW = "unit-test-password-not-real";
const REF = "5fde430a-4ed5-4876-9929-11871c32ff8b";
const OTHER_REF = "0f0e0d0c-0b0a-4908-8706-050403020100";
const ORDER_ID = "3f433da9-2d20-4243-4fd2-08df0df6399e";
const OTHER_ORDER_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const SESSION_ID = "043ad7ca-9e38-474e-f09e-08def275479c";
const OTHER_SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";
const PRODUCT_ID = "prod_1";
const TIMESTAMP = "09/21/2026 19:06:52";
const BUYER_EMAIL = "buyer@example.test";
const SENSITIVE = {
  maskedCardNumber: "446404******0007",
  cardholderName: "Test User",
  tokenId: "3bd75222-05dc-4059-9770-08def08c9c62",
  authenticationToken: "mHyn+7YFi1EUAREAAAAvNUe6Hv8=",
};
const MESSAGES = ["The operation was successful", "Transaction Cancelled By User", "Approved"];

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

interface SessionRow {
  id: string;
  merchantReferenceId: string;
  provider: string;
  environment: string;
  amount: unknown;
  currency: string;
  status: string;
  productId: string;
  providerSessionId: string | null;
  providerOrderId: string | null;
  buyerEmail: string | null;
  providerStatus: string | null;
  failureReason: string | null;
  callbackReceivedAt: Date | null;
}

interface OrderRow extends Record<string, unknown> {
  id: string;
}

const db: { sessions: SessionRow[]; orders: OrderRow[]; products: Map<string, { name: string }> } = {
  sessions: [],
  orders: [],
  products: new Map(),
};
const writes: { model: string; op: string; data: Record<string, unknown>; inTransaction: boolean }[] = [];
const logs: string[] = [];
const emails: Record<string, unknown>[] = [];
const getOrderCalls: string[] = [];
const responses: { status: number; body: Record<string, unknown>; headers: Headers }[] = [];
const signatures = new Set<string>();

const state = {
  configured: true,
  mode: "test" as "test" | "production" | null,
  inquiry: null as null | ((orderId: string) => Record<string, unknown>),
  inquiryError: null as Error | null,
  siteUrl: "https://saiflow.test" as string | undefined,
  publicKey: PK as string | undefined,
  password: PW as string | undefined,
};
let inTransaction = false;

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      if (!(condition as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (condition !== null && typeof condition === "object" && "not" in (condition as object)) {
      if (row[key] === (condition as { not: unknown }).not) return false;
      continue;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

const fake = {
  paymentSession: {
    findUnique: async ({ where }: { where: Where }) => {
      const row = db.sessions.find((r) => matches(r as unknown as Record<string, unknown>, where));
      return row ? { ...row } : null;
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      writes.push({ model: "paymentSession", op: "updateMany", data, inTransaction });
      let count = 0;
      for (const row of db.sessions) {
        if (matches(row as unknown as Record<string, unknown>, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    },
  },
  order: {
    findUnique: async ({ where }: { where: Where }) => {
      const row = db.orders.find((r) => matches(r, where));
      return row ? { id: row.id } : null;
    },
    findFirst: async ({ where }: { where: Where }) => {
      const row = db.orders.find((r) => matches(r, where));
      return row ? { id: row.id } : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      writes.push({ model: "order", op: "create", data, inTransaction });
      if (data.merchantReferenceId !== null && db.orders.some((o) => o.merchantReferenceId === data.merchantReferenceId)) {
        throw p2002();
      }
      if (
        data.providerOrderId !== null &&
        db.orders.some((o) => o.paymentProvider === data.paymentProvider && o.providerOrderId === data.providerOrderId)
      ) {
        throw p2002();
      }
      const row: OrderRow = { id: `order_${db.orders.length + 1}`, ...data };
      db.orders.push(row);
      return { id: row.id };
    },
  },
  product: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const product = db.products.get(where.id);
      return product ? { name: product.name } : null;
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = { sessions: db.sessions.map((s) => ({ ...s })), orders: db.orders.map((o) => ({ ...o })) };
    inTransaction = true;
    try {
      return await fn(fake);
    } catch (error) {
      db.sessions = snapshot.sessions;
      db.orders = snapshot.orders;
      throw error;
    } finally {
      inTransaction = false;
    }
  },
};

let POST: (req: Request) => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: fake } });
  mock.module("@/lib/env", {
    namedExports: {
      env: {
        get GEIDEA_MERCHANT_PUBLIC_KEY() {
          return state.publicKey;
        },
        get GEIDEA_API_PASSWORD() {
          return state.password;
        },
        get GEIDEA_ENV() {
          return state.mode;
        },
        get NEXTAUTH_URL() {
          return state.siteUrl;
        },
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
  mock.module("@/lib/payments/geidea/client", {
    namedExports: {
      isGeideaConfigured: () => state.configured,
      geideaMode: () => state.mode,
      getOrder: async (orderId: string) => {
        getOrderCalls.push(orderId);
        if (state.inquiryError) throw state.inquiryError;
        if (!state.inquiry) throw new Error("test provided no inquiry");
        return state.inquiry(orderId);
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
  POST = (await import("../app/api/webhooks/geidea/route.ts")).POST as typeof POST;
});

/* ------------------------------------------------------------------ */
/* The captured callback, redacted                                      */
/* ------------------------------------------------------------------ */

const PAID_CODES = {
  acquirerCode: "00",
  acquirerMessage: "Approved",
  responseCode: "000",
  responseMessage: "Success",
  detailedResponseCode: "000",
  detailedResponseMessage: "The operation was successful",
};

const paymentMethod = {
  type: "Card",
  brand: "mada",
  cardholderName: SENSITIVE.cardholderName,
  maskedCardNumber: SENSITIVE.maskedCardNumber,
  wallet: null,
  expiryDate: { month: 1, year: 39 },
  issuingCountry: "SAU",
  fundingType: "DEBIT",
};

const authenticationTx = () => ({
  transactionId: "888b7f89-52c7-4511-6245-08df0df639c7",
  type: "Authentication",
  status: "Success",
  amount: 1.0,
  currency: "SAR",
  source: "HPP",
  paymentMethod,
  codes: { ...PAID_CODES, acquirerCode: null, acquirerMessage: null },
  authenticationDetails: { authenticationToken: SENSITIVE.authenticationToken, transactionStatus: "Y" },
  tokenId: SENSITIVE.tokenId,
});

const payTx = (over: Record<string, unknown> = {}, codes: Record<string, unknown> = {}) => ({
  transactionId: "0ff34eca-d4b6-44bc-624e-08df0df639c7",
  type: "Pay",
  status: "Success",
  amount: 1.0,
  currency: "SAR",
  source: "HPP",
  authorizationCode: "091025",
  rrn: "626419091025",
  paymentMethod,
  codes: { ...PAID_CODES, ...codes },
  ...over,
});

interface CallbackOver {
  order?: Record<string, unknown>;
  top?: Record<string, unknown>;
  /** Overrides the Pay transaction; null removes it. */
  pay?: Record<string, unknown> | null;
  payCodes?: Record<string, unknown>;
  signature?: string;
  password?: string;
}

/** A callback body in the real shape, signed for real unless a signature is supplied. */
function callback(over: CallbackOver = {}): Record<string, unknown> {
  const transactions = [authenticationTx(), ...(over.pay === null ? [] : [payTx(over.pay ?? {}, over.payCodes ?? {})])];
  const order: Record<string, unknown> = {
    merchantId: "2a223a37-cacf-4250-e159-08df1164618d",
    orderId: ORDER_ID,
    amount: 1.0,
    tipAmount: 0.0,
    totalAmount: 1.0,
    settleAmount: 1.0,
    currency: "SAR",
    settleCurrency: "SAR",
    language: "en",
    detailedStatus: "Paid",
    status: "Success",
    merchantPublicKey: PK,
    merchantReferenceId: REF,
    callbackUrl: "https://webhook.example.test/test-token",
    returnUrl: null,
    cardOnFile: false,
    tokenId: null,
    paymentOperation: "Pay",
    transactions,
    orderItems: [],
    paymentMethod,
    totalAuthorizedAmount: 1.0,
    totalCapturedAmount: 1.0,
    totalRefundedAmount: 0,
    isTest: true,
    gatewayDecision: "Reject",
    customerName: null,
    customerEmail: null,
    sessionId: SESSION_ID,
    ...over.order,
  };
  const top: Record<string, unknown> = { timeStamp: TIMESTAMP, sessionId: SESSION_ID, ...over.top };
  const signature =
    over.signature ??
    signCallback(
      {
        merchantPublicKey: PK,
        amount: order.amount as number | string,
        currency: order.currency as string,
        orderId: order.orderId as string,
        status: order.status as string,
        merchantReferenceId: order.merchantReferenceId as string,
        timeStamp: top.timeStamp as string,
      },
      over.password ?? PW
    );
  // Only real HMACs join the leak scan; a placeholder such as "x" would
  // match any log line that happens to contain the letter.
  if (over.signature === undefined) signatures.add(signature);
  return { order, signature, ...top };
}

const failedCallback = (over: CallbackOver = {}) =>
  callback({
    order: { status: "Failed", detailedStatus: "Declined", ...over.order },
    pay: { status: "Failed", ...over.pay },
    payCodes: {
      acquirerCode: "05",
      acquirerMessage: "Do not honor",
      responseCode: "100",
      responseMessage: "Failed",
      detailedResponseCode: "137",
      detailedResponseMessage: "Declined",
      ...over.payCodes,
    },
    top: over.top,
  });

/** A closed hosted page: no Pay transaction, a cancelled status. */
const cancelledCallback = () =>
  callback({ order: { status: "Cancelled", detailedStatus: "Cancelled" }, pay: null });

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const res = await POST(
    new Request("https://saiflow.test/api/webhooks/geidea", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
  const parsed = { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
  responses.push(parsed);
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

class FakeDecimal {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

function paidInquiry(orderId: string) {
  return {
    orderId,
    status: "Success",
    detailedStatus: "Paid",
    amount: 1,
    currency: "SAR",
    merchantReferenceId: REF,
    totalRefundedAmount: 0,
  };
}

function reset() {
  db.sessions = [];
  db.orders = [];
  db.products = new Map([[PRODUCT_ID, { name: "Arabic Templates Pack" }]]);
  writes.length = 0;
  emails.length = 0;
  getOrderCalls.length = 0;
  state.configured = true;
  state.mode = "test";
  state.inquiry = paidInquiry;
  state.inquiryError = null;
  state.siteUrl = "https://saiflow.test";
  state.publicKey = PK;
  state.password = PW;
}
beforeEach(reset);

function seed(over: Partial<SessionRow> = {}): SessionRow {
  const row: SessionRow = {
    id: "ps_1",
    merchantReferenceId: REF,
    provider: "GEIDEA",
    environment: "TEST",
    amount: "1.00",
    currency: "SAR",
    status: "SESSION_CREATED",
    productId: PRODUCT_ID,
    providerSessionId: SESSION_ID,
    providerOrderId: null,
    buyerEmail: null,
    providerStatus: null,
    failureReason: null,
    callbackReceivedAt: null,
    ...over,
  };
  db.sessions.push(row);
  return row;
}

const session = () => db.sessions[0];

function assertNothingHappened() {
  assert.equal(db.orders.length, 0, "no Order may exist");
  assert.equal(writes.length, 0, "nothing may be written");
  assert.equal(getOrderCalls.length, 0, "Geidea must not be asked");
  assert.equal(emails.length, 0, "no receipt may be sent");
}

/* ------------------------------------------------------------------ */
/* Paid                                                                */
/* ------------------------------------------------------------------ */

describe("the captured paid callback fulfils exactly once", () => {
  test("creates one Order from the attempt and marks the attempt PAID", async () => {
    const row = seed();
    const res = await post(callback());

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { received: true, result: "fulfilled" });
    assert.equal(res.headers.get("cache-control"), "no-store, must-revalidate");

    assert.equal(db.orders.length, 1);
    const order = db.orders[0];
    assert.equal(order.productId, PRODUCT_ID);
    assert.equal(order.productName, "Arabic Templates Pack");
    assert.equal(order.price, row.amount, "price is the stored amount, untouched");
    assert.equal(order.customerEmail, "");
    assert.equal(order.stripeSessionId, null);
    assert.equal(order.paymentProvider, "GEIDEA");
    assert.equal(order.providerOrderId, ORDER_ID);
    assert.equal(order.merchantReferenceId, REF);
    assert.equal(order.paymentEnvironment, "TEST");
    assert.equal(order.currency, "SAR");

    assert.equal(session().status, "PAID");
    assert.equal(session().providerOrderId, ORDER_ID);
    assert.equal(session().providerStatus, "Success/Paid");
    assert.equal(session().failureReason, null);
    assert.ok(session().callbackReceivedAt instanceof Date);

    assert.deepEqual(getOrderCalls, [ORDER_ID]);
    assert.equal(emails.length, 0, "no email was known, so no receipt");
  });

  test("the claim and the Order happen in one transaction, claim first", async () => {
    seed();
    await post(callback());
    const kinds = writes.map((w) => `${w.model}.${w.op}`);
    assert.deepEqual(kinds, ["paymentSession.updateMany", "order.create"]);
    assert.ok(writes.every((w) => w.inTransaction), "both writes inside the transaction");
    assert.equal(writes[0].data.status, "PAID");
    assert.equal(writes[0].data.providerOrderId, ORDER_ID);
  });

  test("the received log carries the Pay transaction's codes and nothing from the body", async () => {
    seed();
    const before = logs.length;
    await post(callback());
    const received = logs.slice(before).find((l) => l.includes("received"));
    assert.ok(received);
    assert.ok(received.includes("outcome=paid"));
    assert.ok(received.includes("responseCode=000"));
    assert.ok(received.includes("detailedResponseCode=000"));
  });

  test("the price is the stored Decimal object, not the callback's number", async () => {
    const amount = new FakeDecimal("1.00");
    seed({ amount });
    const res = await post(callback());
    assert.equal(res.body.result, "fulfilled");
    assert.equal(db.orders[0].price, amount);
  });

  test("a known buyer email is kept on the Order and receives the receipt", async () => {
    seed({ buyerEmail: BUYER_EMAIL });
    await post(callback());
    assert.equal(db.orders[0].customerEmail, BUYER_EMAIL);
    assert.deepEqual(emails, [
      {
        customerEmail: BUYER_EMAIL,
        productName: "Arabic Templates Pack",
        downloadUrl: `https://saiflow.test/api/download/${PRODUCT_ID}?orderId=order_1`,
      },
    ]);
  });

  test("the callback's own customer fields are never used", async () => {
    seed({ buyerEmail: null });
    await post(callback({ order: { customerEmail: "attacker@example.test", customerName: "Mallory" } }));
    assert.equal(db.orders[0].customerEmail, "");
    assert.equal(emails.length, 0);
  });

  test("the receipt is skipped, not the fulfilment, when no site URL is configured", async () => {
    seed({ buyerEmail: BUYER_EMAIL });
    state.siteUrl = undefined;
    const res = await post(callback());
    assert.equal(res.body.result, "fulfilled");
    assert.equal(db.orders.length, 1);
    assert.equal(emails.length, 0);
  });

  test("a production attempt on a production deployment records PRODUCTION", async () => {
    state.mode = "production";
    seed({ environment: "PRODUCTION" });
    const res = await post(callback({ order: { isTest: false } }));
    assert.equal(res.body.result, "fulfilled");
    assert.equal(db.orders[0].paymentEnvironment, "PRODUCTION");
  });

  test("an amount rendered differently but equal still fulfils", async () => {
    seed({ amount: "1" });
    const res = await post(callback({ order: { amount: "1.00" }, pay: { amount: "1.0" } }));
    assert.equal(res.body.result, "fulfilled");
  });

  test("optional session id, isTest and payment operation may be absent", async () => {
    seed();
    const res = await post(
      callback({ order: { sessionId: undefined, isTest: undefined, paymentOperation: undefined }, top: { sessionId: undefined } })
    );
    assert.equal(res.body.result, "fulfilled");
  });

  test("an attempt that never recorded a provider session id is not checked against one", async () => {
    seed({ providerSessionId: null });
    const res = await post(callback());
    assert.equal(res.body.result, "fulfilled");
  });

  test("a paid retry after a failed first attempt in the same session fulfils", async () => {
    seed({ status: "FAILED", providerOrderId: ORDER_ID, failureReason: "provider_failed" });
    const res = await post(callback());
    assert.equal(res.body.result, "fulfilled");
    assert.equal(session().status, "PAID");
    assert.equal(session().failureReason, null);
    assert.equal(db.orders.length, 1);
  });
});

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

describe("a duplicate paid callback creates nothing", () => {
  test("the second delivery answers success without a second inquiry, write or receipt", async () => {
    seed({ buyerEmail: BUYER_EMAIL });
    await post(callback());
    const writesAfterFirst = writes.length;

    const res = await post(callback());
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { received: true, result: "already_fulfilled" });
    assert.equal(db.orders.length, 1);
    assert.equal(writes.length, writesAfterFirst);
    assert.equal(getOrderCalls.length, 1);
    assert.equal(emails.length, 1);
  });

  test("a lost race is settled by the Order's unique constraints", async () => {
    seed();
    db.orders.push({ id: "order_other", merchantReferenceId: OTHER_REF, paymentProvider: "GEIDEA", providerOrderId: ORDER_ID });
    const res = await post(callback());
    assert.deepEqual(res.body, { received: true, result: "already_fulfilled" });
    assert.equal(db.orders.length, 1);
    assert.equal(session().status, "SESSION_CREATED", "the claim was rolled back with the failed insert");
    assert.equal(emails.length, 0);
  });

  test("a PAID attempt with no Order is blocked, never silently re-fulfilled", async () => {
    seed({ status: "PAID", providerOrderId: ORDER_ID });
    const res = await post(callback());
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "fulfilment_blocked" });
    assert.equal(db.orders.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

describe("refusals create no Order and change nothing", () => {
  test("an invalid signature is refused before the database is touched", async () => {
    seed();
    let res = await post(callback({ password: `${PW}-2` }));
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "invalid_signature" });
    assertNothingHappened();

    const signed = callback();
    (signed.order as Record<string, unknown>).amount = 2;
    res = await post(signed);
    assert.equal(res.status, 400);
    assertNothingHappened();

    res = await post(callback({ signature: "not-a-signature" }));
    assert.equal(res.status, 400);
    assertNothingHappened();
  });

  test("an unknown merchantReferenceId is refused", async () => {
    seed();
    const res = await post(callback({ order: { merchantReferenceId: OTHER_REF } }));
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "unknown_reference" });
    assertNothingHappened();
  });

  test("an amount that differs from the attempt is refused", async () => {
    for (const amount of [2, 0.99, "10.0", 100]) {
      reset();
      seed();
      const res = await post(callback({ order: { amount } }));
      assert.equal(res.status, 409, String(amount));
      assert.deepEqual(res.body, { error: "mismatch" });
      assertNothingHappened();
      assert.equal(session().status, "SESSION_CREATED");
    }
  });

  test("a currency that differs from the attempt is refused", async () => {
    seed();
    const res = await post(callback({ order: { currency: "EGP" } }));
    assert.equal(res.status, 409);
    assertNothingHappened();
  });

  test("a wrong provider or a wrong environment is refused", async () => {
    seed({ provider: "STRIPE" });
    let res = await post(callback());
    assert.equal(res.status, 409);
    assertNothingHappened();

    reset();
    seed({ environment: "PRODUCTION" });
    res = await post(callback());
    assert.equal(res.status, 409, "a production attempt on a test deployment");
    assertNothingHappened();

    reset();
    state.mode = "production";
    seed({ environment: "TEST" });
    res = await post(callback());
    assert.equal(res.status, 409, "a test attempt on a production deployment");
    assertNothingHappened();
  });

  test("Geidea's own isTest flag must agree with the deployment", async () => {
    seed();
    let res = await post(callback({ order: { isTest: false } }));
    assert.equal(res.status, 409, "a live order arriving at a test deployment");
    assertNothingHappened();

    reset();
    state.mode = "production";
    seed({ environment: "PRODUCTION" });
    res = await post(callback({ order: { isTest: true } }));
    assert.equal(res.status, 409, "a test order arriving at a production deployment");
    assertNothingHappened();
  });

  test("a session id that differs from the attempt's is refused, in either copy", async () => {
    seed();
    let res = await post(callback({ order: { sessionId: OTHER_SESSION_ID } }));
    assert.equal(res.status, 409);
    assertNothingHappened();

    reset();
    seed();
    res = await post(callback({ top: { sessionId: OTHER_SESSION_ID } }));
    assert.equal(res.status, 409);
    assertNothingHappened();
  });

  test("a payment operation other than Pay is refused", async () => {
    seed();
    const res = await post(callback({ order: { paymentOperation: "PreAuthorize" } }));
    assert.equal(res.status, 409);
    assertNothingHappened();
  });

  test("a different provider order id than the one already recorded is refused", async () => {
    seed({ providerOrderId: OTHER_ORDER_ID });
    const res = await post(callback());
    assert.equal(res.status, 409);
    assertNothingHappened();
  });

  test("anything short of the full success values never creates an Order", async () => {
    const variants: [string, CallbackOver][] = [
      ["Pay codes 100 with a failed order", { order: { status: "Failed", detailedStatus: "Declined" }, pay: { status: "Failed" }, payCodes: { responseCode: "100" } }],
      ["Pay codes 100 beside a paid order", { payCodes: { responseCode: "100" } }],
      ["detailedResponseCode 500", { payCodes: { detailedResponseCode: "500" } }],
      ["detailedResponseCode absent", { payCodes: { detailedResponseCode: undefined } }],
      ["responseMessage not Success", { payCodes: { responseMessage: "OK" } }],
      ["detailedResponseMessage not the documented text", { payCodes: { detailedResponseMessage: "Success" } }],
      ["no codes on the Pay transaction", { pay: { codes: undefined } }],
      ["Pay transaction status Failed", { pay: { status: "Failed" } }],
      ["no Pay transaction", { pay: null }],
      ["order status InProgress", { order: { status: "InProgress", detailedStatus: undefined } }],
      ["detailed status Authorized", { order: { detailedStatus: "Authorized" } }],
      ["detailed status absent", { order: { detailedStatus: undefined } }],
    ];
    for (const [name, over] of variants) {
      reset();
      seed();
      const res = await post(callback(over));
      assert.equal(res.status, 200, name);
      assert.equal(db.orders.length, 0, name);
      assert.equal(getOrderCalls.length, 0, name);
      assert.equal(emails.length, 0, name);
      assert.notEqual(session().status, "PAID", name);
    }
  });

  test("malformed payloads fail closed", async () => {
    seed();
    const bodies: [string, unknown][] = [
      ["not JSON", "<html>"],
      ["empty", ""],
      ["an array", [callback()]],
      ["no order", { ...callback(), order: undefined }],
      ["orderId not a UUID", callback({ order: { orderId: "42" }, signature: "x" })],
      ["amount text", callback({ order: { amount: "abc" }, signature: "x" })],
      ["amount three decimals", callback({ order: { amount: 1.005 }, signature: "x" })],
      ["currency lower-case", callback({ order: { currency: "sar" }, signature: "x" })],
      ["reference not a UUID", callback({ order: { merchantReferenceId: "ref-1" }, signature: "x" })],
      ["transactions not an array", callback({ order: { transactions: "none" } })],
      ["a transaction without a type", callback({ pay: { type: undefined } })],
      ["order sessionId not a UUID", callback({ order: { sessionId: "sess" } })],
      ["isTest not a boolean", callback({ order: { isTest: "yes" } })],
      ["signature missing", { ...callback(), signature: undefined }],
      ["timeStamp missing", callback({ top: { timeStamp: undefined }, signature: "x" })],
    ];
    for (const [name, body] of bodies) {
      const res = await post(body);
      assert.equal(res.status, 400, name);
      assert.deepEqual(res.body, { error: "malformed" }, name);
      assertNothingHappened();
    }
  });

  test("an oversized body is refused before parsing", async () => {
    seed();
    const res = await post(`{"pad":"${"x".repeat(70 * 1024)}"}`);
    assert.equal(res.status, 413);
    assertNothingHappened();
  });

  test("a missing GEIDEA_ENV fails closed as not configured", async () => {
    seed();
    state.mode = null;
    state.configured = false;
    let res = await post(callback());
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: "not_configured" });
    assertNothingHappened();

    reset();
    seed();
    state.mode = null;
    state.configured = true;
    res = await post(callback());
    assert.equal(res.status, 503, "a null mode is never treated as test");
    assertNothingHappened();
  });

  test("a deployment without Geidea configuration refuses everything", async () => {
    seed();
    state.configured = false;
    let res = await post(callback());
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: "not_configured" });
    assertNothingHappened();

    reset();
    seed();
    state.password = undefined;
    res = await post(callback());
    assert.equal(res.status, 503);
    assertNothingHappened();
  });
});

/* ------------------------------------------------------------------ */
/* Failed and cancelled                                                */
/* ------------------------------------------------------------------ */

describe("failed and cancelled callbacks close the attempt and nothing more", () => {
  test("a declined payment moves the attempt to FAILED with a short reason", async () => {
    seed();
    const res = await post(failedCallback());
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { received: true, result: "failed" });
    assert.equal(session().status, "FAILED");
    assert.equal(session().providerStatus, "Failed/Declined");
    assert.equal(session().failureReason, "provider_failed");
    assert.equal(session().providerOrderId, ORDER_ID);
    assert.ok(session().callbackReceivedAt instanceof Date);
    assert.equal(db.orders.length, 0);
    assert.equal(getOrderCalls.length, 0);
    assert.equal(emails.length, 0);
    assert.equal(writes.length, 1);
  });

  test("a closed hosted page moves the attempt to CANCELLED", async () => {
    seed();
    const res = await post(cancelledCallback());
    assert.deepEqual(res.body, { received: true, result: "cancelled" });
    assert.equal(session().status, "CANCELLED");
    assert.equal(session().failureReason, "cancelled_by_user");
    assert.equal(session().providerStatus, "Cancelled/Cancelled");
    assert.equal(db.orders.length, 0);
  });

  test("a cancellation signalled only in a transaction message is still a cancellation", async () => {
    seed();
    const res = await post(
      failedCallback({ order: { detailedStatus: "Failed" }, payCodes: { detailedResponseCode: "600", detailedResponseMessage: "Transaction Cancelled By User" } })
    );
    assert.equal(res.body.result, "cancelled");
    assert.equal(session().status, "CANCELLED");
  });

  test("an expired session moves the attempt to EXPIRED", async () => {
    seed();
    const res = await post(callback({ order: { status: "Expired", detailedStatus: "Expired" }, pay: null }));
    assert.equal(res.body.result, "expired");
    assert.equal(session().status, "EXPIRED");
    assert.equal(session().failureReason, "expired");
  });

  test("a paid attempt is never downgraded by a later failure callback", async () => {
    seed({ buyerEmail: BUYER_EMAIL });
    await post(callback());
    assert.equal(session().status, "PAID");

    const res = await post(failedCallback());
    assert.deepEqual(res.body, { received: true, result: "ignored" });
    assert.equal(session().status, "PAID");
    assert.equal(session().failureReason, null);
    assert.equal(db.orders.length, 1);
  });

  test("an undecided callback is recorded without changing the status", async () => {
    seed();
    const res = await post(callback({ order: { status: "InProgress", detailedStatus: undefined }, pay: null }));
    assert.deepEqual(res.body, { received: true, result: "recorded" });
    assert.equal(session().status, "SESSION_CREATED");
    assert.equal(session().providerStatus, "InProgress");
    assert.equal(session().providerOrderId, ORDER_ID);
    assert.equal(db.orders.length, 0);
  });

  test("nothing sensitive from the callback is written to the attempt", async () => {
    seed();
    await post(failedCallback());
    const text = JSON.stringify(writes);
    for (const value of Object.values(SENSITIVE)) assert.ok(!text.includes(value), value);
    assert.ok(!text.includes("Do not honor"));
    assert.deepEqual(Object.keys(writes[0].data).sort(), ["callbackReceivedAt", "failureReason", "providerOrderId", "providerStatus", "status"]);
  });
});

/* ------------------------------------------------------------------ */
/* The inquiry                                                         */
/* ------------------------------------------------------------------ */

describe("defence in depth: Geidea must agree before anything is fulfilled", () => {
  test("the inquiry is made for the callback's order id, and only for paid outcomes", async () => {
    seed();
    await post(callback());
    assert.deepEqual(getOrderCalls, [ORDER_ID]);

    reset();
    seed();
    await post(failedCallback());
    await post(cancelledCallback());
    await post(callback({ password: `${PW}-2` }));
    assert.deepEqual(getOrderCalls, []);
  });

  test("an inquiry that cannot be made leaves the attempt untouched and asks for a retry", async () => {
    for (const error of [
      Object.assign(new Error("Geidea getOrder: HTTP 503"), { name: "GeideaHttpError" }),
      Object.assign(new Error("Geidea getOrder: malformed response at $"), { name: "GeideaResponseError" }),
      Object.assign(new Error(`connect ECONNREFUSED ${PW}`), { name: "Error" }),
    ]) {
      reset();
      seed();
      state.inquiryError = error;
      const res = await post(callback());
      assert.equal(res.status, 503, error.name);
      assert.deepEqual(res.body, { error: "verification_unavailable" });
      assert.equal(db.orders.length, 0);
      assert.equal(writes.length, 0);
      assert.equal(session().status, "SESSION_CREATED");
      assert.equal(emails.length, 0);
    }
  });

  test("an inquiry that disagrees on any point prevents fulfilment", async () => {
    const disagreements: [string, (id: string) => Record<string, unknown>][] = [
      ["amount", (id) => ({ ...paidInquiry(id), amount: 2 })],
      ["currency", (id) => ({ ...paidInquiry(id), currency: "EGP" })],
      ["status", (id) => ({ ...paidInquiry(id), status: "Failed", detailedStatus: "Declined" })],
      ["refunded", (id) => ({ ...paidInquiry(id), detailedStatus: "Refunded" })],
      ["detailed status missing", (id) => ({ ...paidInquiry(id), detailedStatus: null })],
      ["order id", () => paidInquiry(OTHER_ORDER_ID)],
      ["reference", (id) => ({ ...paidInquiry(id), merchantReferenceId: OTHER_REF })],
    ];
    for (const [name, inquiry] of disagreements) {
      reset();
      seed();
      state.inquiry = inquiry;
      const res = await post(callback());
      assert.equal(res.status, 409, name);
      assert.deepEqual(res.body, { error: "verification_mismatch" }, name);
      assert.equal(db.orders.length, 0, name);
      assert.equal(writes.length, 0, name);
      assert.equal(session().status, "SESSION_CREATED", name);
    }
  });

  test("an inquiry without a merchant reference still agrees", async () => {
    seed();
    state.inquiry = (id) => ({ ...paidInquiry(id), merchantReferenceId: null });
    const res = await post(callback());
    assert.equal(res.body.result, "fulfilled");
  });
});

/* ------------------------------------------------------------------ */
/* Fulfilment failures roll back                                       */
/* ------------------------------------------------------------------ */

describe("a fulfilment that cannot complete leaves no half-purchase", () => {
  test("a missing product rolls the claim back and blocks", async () => {
    seed();
    db.products.clear();
    const res = await post(callback());
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "fulfilment_blocked" });
    assert.equal(db.orders.length, 0);
    assert.equal(session().status, "SESSION_CREATED", "the PAID claim must not survive the rollback");
    assert.equal(emails.length, 0);
  });

  test("an unexpected database error is a 500 with no detail", async () => {
    seed();
    const original = fake.product.findUnique;
    fake.product.findUnique = async () => {
      throw new Error(`boom ${PW}`);
    };
    try {
      const res = await post(callback());
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: "internal" });
      assert.equal(db.orders.length, 0);
      assert.equal(session().status, "SESSION_CREATED");
    } finally {
      fake.product.findUnique = original;
    }
  });
});

/* ------------------------------------------------------------------ */
/* Download authorisation is untouched                                  */
/* ------------------------------------------------------------------ */

describe("a PaymentSession alone still cannot authorise a download", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("the download route was not changed and never reads attempts", () => {
    const download = strip(read("app/api/download/[productId]/route.ts"));
    assert.ok(!/paymentSession/i.test(download));
    assert.ok(!download.includes("payments/geidea"));
    assert.equal((download.match(/prisma\.order\.findUnique\(/g) ?? []).length, 3, "three explicit Order channels, none through attempts");
    assert.match(download, /if \(!order\) \{[\s\S]*?status: 403/);
  });

  test("the callback route creates an Order in exactly one place, inside the transaction, after the claim", () => {
    const route = strip(read("app/api/webhooks/geidea/route.ts"));
    assert.equal((route.match(/\.order\.create\(/g) ?? []).length, 1);
    const tx = route.indexOf("prisma.$transaction(");
    const claim = route.indexOf("tx.paymentSession.updateMany(", tx);
    const create = route.indexOf("tx.order.create(", claim);
    assert.ok(tx > 0 && claim > tx && create > claim);
    assert.ok(!route.includes("createDeliveryUrl"), "fulfilment is not delivery");
    assert.ok(!route.includes("isDeliverableSafe"), "delivery safety is the download gate's decision");
  });

  test("only POST is exported, with the Node runtime, and the verifier is the shared one", () => {
    const route = strip(read("app/api/webhooks/geidea/route.ts"));
    assert.ok(/export async function POST\(/.test(route));
    assert.ok(!/export (async )?function (GET|PUT|DELETE|PATCH)\b/.test(route));
    assert.ok(route.includes('export const runtime = "nodejs"'));
    assert.ok(route.includes("verifyCallbackSignature("));
    assert.ok(!route.includes("createHmac"), "the route computes no signature of its own");
  });
});

/* ------------------------------------------------------------------ */
/* Nothing leaks                                                       */
/* ------------------------------------------------------------------ */

describe("no secret or sensitive callback data appears in logs, writes or responses", () => {
  test("after every scenario above", async () => {
    reset();
    seed({ buyerEmail: BUYER_EMAIL });
    await post(callback());
    await post(callback());
    await post(failedCallback());
    reset();
    seed();
    await post(callback({ password: `${PW}-2` }));
    await post("<not json>");

    const forbidden = [PW, PK, BUYER_EMAIL, ...Object.values(SENSITIVE), ...MESSAGES, ...signatures];
    const logText = logs.join("\n");
    const writeText = JSON.stringify(writes.map((w) => ({ ...w, data: { ...w.data, customerEmail: undefined } })));
    const responseText = JSON.stringify(responses.map((r) => r.body));
    for (const value of forbidden) {
      assert.ok(!logText.includes(value), `log leaked ${value.slice(0, 12)}`);
      assert.ok(!writeText.includes(value), `write leaked ${value.slice(0, 12)}`);
      assert.ok(!responseText.includes(value), `response leaked ${value.slice(0, 12)}`);
    }
    // Bearers: the reference opens the file on the success channel and the
    // Order id on the receipt channel. Both are written to the database, so
    // they may appear in writes, but never in a log line in full.
    for (const bearer of [REF, "order_1", "order_other"]) {
      assert.ok(!logText.includes(bearer), `log carries a bearer in full: ${bearer}`);
    }
    assert.ok(logText.includes(`ref=${REF.slice(0, 8)}…`), "a prefix remains for correlation");
    assert.ok(logText.includes("order=orde…"), "the Order id is redacted, not omitted");
    assert.ok(!/Authorization|Basic /.test(logText));
    assert.ok(logs.length > 0, "the route does log events");
    for (const line of logs) {
      assert.ok(line.startsWith("[Geidea callback] "), line);
      assert.ok(line.length < 400, "a log line long enough to be a payload");
      assert.ok(!line.includes("{"), "a log line must not carry an object");
    }
  });

  test("responses are fixed codes, never messages from Geidea or the database", () => {
    const bodies = new Set(responses.map((r) => JSON.stringify(r.body)));
    for (const body of bodies) {
      const keys = Object.keys(JSON.parse(body) as Record<string, unknown>).sort();
      assert.ok(keys.join(",") === "error" || keys.join(",") === "received,result", body);
    }
  });
});
