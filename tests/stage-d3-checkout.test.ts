/**
 * Stage D3 — the scan verdict gates checkout.
 *
 * These execute the real POST handler against real Requests and read real
 * Responses. Prisma, Stripe, the env module and global fetch are replaced by
 * doubles; `isDeliverableSafe` is the REAL reviewed predicate, because it is
 * the thing under test.
 *
 * The assertion that matters most is not "refused" — it is "refused AND Stripe
 * was never called". A gate that returns 400 after creating a payment session
 * would look identical in a status-code-only test, so every refusal below also
 * asserts zero session-creation calls.
 *
 * No payment API is contacted, no storage is touched, and no network call is
 * made. Global fetch is stubbed to record and throw, which is also how the
 * removal of the old HEAD liveness probe is proved at runtime rather than by
 * grepping the source.
 */

import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = () =>
  readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");

const KEY = "abc123XY_key-one";
const OTHER_KEY = "zzz999QQ_key-two";

process.env.STRIPE_SECRET_KEY = "sk_test_not_a_real_key";
process.env.NEXTAUTH_URL = "https://saiflow.test";

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  slug: string;
  isActive: boolean;
  moderationStatus: string;
  fileUrl: string | null;
  fileKey: string | null;
  fileScanStatus: string;
  fileScanKey: string | null;
  shop: { isActive: boolean; slug: string };
}

const state: {
  product: ProductRow | null;
  preLaunch: boolean;
  sessionCalls: unknown[];
  fetchCalls: { url: string; method?: string }[];
} = { product: null, preLaunch: false, sessionCalls: [], fetchCalls: [] };

function reset() {
  state.product = null;
  state.preLaunch = false;
  state.sessionCalls = [];
  state.fetchCalls = [];
}
reset();

let POST: (req: Request) => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        product: {
          findUnique: async () => state.product,
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
        },
      },
    },
  });

  // The real module validates the whole server env at import time.
  // One stable object with a live getter: the route holds a reference to `env`
  // from import time, so the flag has to be readable through it, not snapshot.
  mock.module("@/lib/env", {
    namedExports: {
      env: {
        get PRE_LAUNCH_MODE() {
          return state.preLaunch;
        },
      },
    },
  });

  // A Stripe double that records rather than calls. Any real network attempt
  // would surface as a fetch call, which is asserted against separately.
  mock.module("stripe", {
    defaultExport: class FakeStripe {
      checkout = {
        sessions: {
          create: async (args: unknown) => {
            state.sessionCalls.push(args);
            return { url: "https://checkout.stripe.test/session/cs_test_123" };
          },
        },
      };
    },
  });

  // Records and refuses. If any code path still probes a URL, the test that
  // asserts an empty call list fails, and the probe itself cannot succeed.
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    state.fetchCalls.push({
      url: String((input as { url?: string })?.url ?? input),
      method: init?.method,
    });
    throw new Error("network access is not permitted in tests");
  }) as typeof fetch;

  POST = (await import("../app/api/checkout/route.ts")).POST as typeof POST;
});

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: "prod_1",
  name: "Arabic Templates Pack",
  description: "A pack",
  price: 49,
  currency: "SAR",
  slug: "arabic-templates-pack",
  isActive: true,
  moderationStatus: "APPROVED",
  fileUrl: "https://app.ufs.sh/f/abc123XY_key-one",
  fileKey: KEY,
  fileScanStatus: "SAFE",
  fileScanKey: KEY,
  shop: { isActive: true, slug: "my-shop" },
  ...over,
});

const checkout = (body: unknown = { productId: "prod_1" }) =>
  POST(
    new Request("https://saiflow.test/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

/** Refused, and provably before any payment side effect. */
async function assertRefusedBeforePayment(res: Response, expectedCode?: string) {
  assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
  assert.equal(
    state.sessionCalls.length,
    0,
    "a refusal must not create a payment session"
  );
  const body = await res.json();
  if (expectedCode) assert.equal(body.error, expectedCode);
  return body;
}

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

describe("checkout: only a SAFE, key-bound deliverable may be sold", () => {
  test("SAFE with a matching key reaches the payment path", async () => {
    reset();
    state.product = product();

    const res = await checkout();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.url, "https://checkout.stripe.test/session/cs_test_123");
    assert.equal(state.sessionCalls.length, 1, "the session must be created");
  });

  test("PENDING_SCAN is refused", async () => {
    reset();
    // The ordinary state of a just-uploaded file: attached, not yet scanned.
    state.product = product({ fileScanStatus: "PENDING_SCAN", fileScanKey: null });
    await assertRefusedBeforePayment(await checkout(), "file_not_ready");
  });

  test("SCAN_ERROR is refused", async () => {
    reset();
    state.product = product({ fileScanStatus: "SCAN_ERROR" });
    await assertRefusedBeforePayment(await checkout(), "file_not_ready");
  });

  test("UNSAFE is refused", async () => {
    reset();
    state.product = product({ fileScanStatus: "UNSAFE" });
    await assertRefusedBeforePayment(await checkout(), "file_not_ready");
  });

  test("a SAFE verdict bound to a DIFFERENT key is refused", async () => {
    reset();
    // The file was replaced after passing. The verdict is real, but it
    // describes bytes this product no longer points at.
    state.product = product({ fileScanStatus: "SAFE", fileScanKey: OTHER_KEY });
    await assertRefusedBeforePayment(await checkout(), "file_not_ready");
  });

  test("a missing file key is refused even when the status says SAFE", async () => {
    reset();
    state.product = product({ fileKey: null, fileScanStatus: "SAFE", fileScanKey: null });
    // Both keys null: `null === null` is true in JavaScript, so the key
    // comparison alone would pass. The non-null clause is what refuses.
    await assertRefusedBeforePayment(await checkout(), "file_not_ready");
  });

  test("an unknown or future scan status is refused", async () => {
    reset();
    state.product = product({ fileScanStatus: "QUARANTINED" });
    await assertRefusedBeforePayment(await checkout(), "file_not_ready");
  });

  test("every non-SAFE status is refused, exhaustively", async () => {
    for (const status of [
      "PENDING_SCAN",
      "SCAN_ERROR",
      "UNSAFE",
      "QUARANTINED",
      "safe",
      "Safe",
      "",
    ]) {
      reset();
      state.product = product({ fileScanStatus: status });
      const res = await checkout();
      assert.equal(res.status, 400, `status "${status}" must refuse`);
      assert.equal(state.sessionCalls.length, 0, `status "${status}" paid out`);
    }
  });

  test("the refusal does not disclose which state failed", async () => {
    // A buyer must not learn whether a seller's file is merely unscanned or
    // was rejected as malware.
    const bodies: string[] = [];
    for (const status of ["PENDING_SCAN", "SCAN_ERROR", "UNSAFE"]) {
      reset();
      state.product = product({ fileScanStatus: status });
      bodies.push(await (await checkout()).text());
    }
    assert.equal(new Set(bodies).size, 1, "all three must answer identically");
    for (const b of bodies) {
      assert.ok(!/unsafe|malware|virus|pending|scan_error/i.test(b), b);
    }
  });
});

/* ------------------------------------------------------------------ */
/* No client input can influence the decision                          */
/* ------------------------------------------------------------------ */

describe("checkout: the buyer cannot influence the scan decision", () => {
  test("scan fields in the request body are ignored", async () => {
    reset();
    state.product = product({ fileScanStatus: "UNSAFE" });

    const res = await checkout({
      productId: "prod_1",
      fileScanStatus: "SAFE",
      fileScanKey: KEY,
      fileKey: KEY,
      isDeliverableSafe: true,
    });

    await assertRefusedBeforePayment(res, "file_not_ready");
  });

  test("a client-supplied storage key cannot substitute for the row's", async () => {
    reset();
    state.product = product({ fileKey: null, fileScanStatus: "SAFE", fileScanKey: null });
    const res = await checkout({ productId: "prod_1", fileKey: KEY, key: KEY });
    await assertRefusedBeforePayment(res, "file_not_ready");
  });

  test("the route reads only productId from the body", async () => {
    reset();
    state.product = product();
    // A body carrying hostile extras still succeeds on the row's own merits,
    // proving the extras are neither read nor rejected — simply irrelevant.
    const res = await checkout({
      productId: "prod_1",
      price: 0,
      currency: "usd",
      fileScanStatus: "UNSAFE",
    });
    assert.equal(res.status, 200);
    const args = state.sessionCalls[0] as {
      line_items: { price_data: { unit_amount: number; currency: string } }[];
    };
    // Pricing still comes from the row, not the request.
    assert.equal(args.line_items[0].price_data.unit_amount, 4900);
    assert.equal(args.line_items[0].price_data.currency, "sar");
  });
});

/* ------------------------------------------------------------------ */
/* The HEAD liveness probe is gone                                     */
/* ------------------------------------------------------------------ */

describe("checkout makes no outbound request of its own", () => {
  test("a successful checkout performs no fetch", async () => {
    reset();
    state.product = product();
    const res = await checkout();
    assert.equal(res.status, 200);
    assert.deepEqual(
      state.fetchCalls,
      [],
      "the HEAD liveness probe must be gone — it 403s on private objects"
    );
  });

  test("a refused checkout performs no fetch either", async () => {
    reset();
    state.product = product({ fileScanStatus: "PENDING_SCAN" });
    await checkout();
    assert.deepEqual(state.fetchCalls, []);
  });

  test("no signed URL is minted by checkout", async () => {
    reset();
    state.product = product();
    await checkout();
    const src = routeSrc();
    assert.ok(!src.includes("createDeliveryUrl"), "checkout must not sign");
    assert.ok(!src.includes("readPrivateObject"), "checkout must not read bytes");
    assert.ok(!/method: "HEAD"/.test(src), "the HEAD probe must not return");
  });

  test("checkout triggers no scan", async () => {
    const src = routeSrc();
    assert.ok(!src.includes("scanFileAsset"));
    assert.ok(!src.includes("internal/scan"));
  });
});

/* ------------------------------------------------------------------ */
/* The pre-existing gates still hold                                   */
/* ------------------------------------------------------------------ */

describe("checkout: existing gates are preserved", () => {
  test("an inactive product is still refused", async () => {
    reset();
    state.product = product({ isActive: false });
    await assertRefusedBeforePayment(await checkout());
  });

  test("a non-approved product is still refused", async () => {
    for (const status of ["PENDING", "REJECTED"]) {
      reset();
      state.product = product({ moderationStatus: status });
      await assertRefusedBeforePayment(await checkout());
    }
  });

  test("an inactive shop is still refused", async () => {
    reset();
    state.product = product({ shop: { isActive: false, slug: "my-shop" } });
    await assertRefusedBeforePayment(await checkout());
  });

  test("a product with no file is still refused", async () => {
    reset();
    state.product = product({ fileUrl: null });
    await assertRefusedBeforePayment(await checkout());
  });

  test("a missing product is still 404", async () => {
    reset();
    state.product = null;
    const res = await checkout();
    assert.equal(res.status, 404);
    assert.equal(state.sessionCalls.length, 0);
  });

  test("a missing productId is still 400", async () => {
    reset();
    const res = await checkout({});
    assert.equal(res.status, 400);
    assert.equal(state.sessionCalls.length, 0);
  });

  test("pre-launch still refuses before anything else", async () => {
    reset();
    state.preLaunch = true;
    state.product = product();
    const res = await checkout();
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "pre_launch");
    assert.equal(state.sessionCalls.length, 0);
  });

  test("the moderation gate runs before the scan gate", async () => {
    // A product that fails BOTH must report the pre-existing availability
    // message, so D3 has not reordered the existing refusals.
    reset();
    state.product = product({ isActive: false, fileScanStatus: "UNSAFE" });
    const body = await assertRefusedBeforePayment(await checkout());
    assert.notEqual(body.error, "file_not_ready");
  });

  test("pricing and metadata are unchanged for a SAFE product", async () => {
    reset();
    state.product = product();
    await checkout();
    const args = state.sessionCalls[0] as {
      mode: string;
      metadata: { productId: string };
      line_items: { price_data: { unit_amount: number } }[];
      success_url: string;
    };
    assert.equal(args.mode, "payment");
    assert.equal(args.metadata.productId, "prod_1");
    assert.equal(args.line_items[0].price_data.unit_amount, 4900);
    assert.ok(args.success_url.includes("/success?session_id="));
  });
});

/* ------------------------------------------------------------------ */
/* The gate uses the reviewed authority                                */
/* ------------------------------------------------------------------ */

describe("checkout uses the single safety authority", () => {
  test("it calls isDeliverableSafe directly", () => {
    const s = routeSrc();
    assert.ok(s.includes('import { isDeliverableSafe } from "@/lib/file-safety"'));
    assert.ok(/if \(!isDeliverableSafe\(product\)\)/.test(s));
  });

  test("it does not re-derive the predicate inline", () => {
    const s = routeSrc();
    // Reading the status on its own is the exact bug lib/file-safety warns
    // about, and a second authority is how the two drift apart.
    assert.ok(
      !/fileScanStatus\s*===/.test(s),
      "checkout must not test the status itself"
    );
    assert.ok(
      !/fileScanKey\s*===/.test(s),
      "checkout must not compare the keys itself"
    );
    assert.ok(!s.includes("deliverableGateReason"), "one authority, not two");
  });

  test("the payment session is created only after the gate", () => {
    const s = routeSrc();
    const gate = s.indexOf("if (!isDeliverableSafe(product))");
    const pay = s.indexOf("checkout.sessions.create");
    assert.ok(gate > 0 && pay > gate, "the gate must precede session creation");
  });
});
