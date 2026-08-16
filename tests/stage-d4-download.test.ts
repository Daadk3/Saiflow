/**
 * Stage D4 — the scan verdict gates buyer delivery.
 *
 * These execute the real GET handler against real Requests and read real
 * Responses. Prisma, the rate limiter and the signer are doubles;
 * `isDeliverableSafe` is the REAL reviewed predicate, because it is the thing
 * under test.
 *
 * Every refusal asserts two things, not one: the status, AND that zero signing
 * calls occurred. A gate that refused after minting a credential would look
 * identical in a status-only test, and the credential is the whole asset.
 *
 * The rate limiter is mocked because lib/rate-limit.ts starts a module-level
 * `setInterval` that is never unref'd, so importing it would keep this process
 * alive forever. Pre-existing, untouched, and noted in the D2 suite too.
 *
 * No network call, no storage call, nothing really signed.
 */

import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const routeSrc = () => read("../app/api/download/[productId]/route.ts");

const KEY = "abc123XY_key-one";
const OTHER_KEY = "zzz999QQ_key-two";
const SIGNED_URL = "https://signed.example.test/f/abc?sig=SECRET";
const LEGACY_PUBLIC_URL = "https://utfs.io/f/legacy-public-object";

interface OrderRow {
  id: string;
  productId: string;
}
interface ProductRow {
  id: string;
  name: string;
  fileKey: string | null;
  fileScanStatus: string;
  fileScanKey: string | null;
}

const state: {
  order: OrderRow | null;
  product: ProductRow | null;
  signResult: unknown;
  signCalls: { key: string; opts: unknown }[];
  productSelect: Record<string, boolean> | null;
  logs: string[];
} = {
  order: null,
  product: null,
  signResult: null,
  signCalls: [],
  productSelect: null,
  logs: [],
};

function reset() {
  state.order = null;
  state.product = null;
  state.signResult = { ok: true, url: SIGNED_URL, expiresAt: new Date(0) };
  state.signCalls = [];
  state.productSelect = null;
  state.logs = [];
}
reset();

let GET: (
  req: Request,
  ctx: { params: Promise<{ productId: string }> }
) => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        order: { findUnique: async () => state.order },
        product: {
          findUnique: async (args: { select?: Record<string, boolean> }) => {
            state.productSelect = args?.select ?? null;
            return state.product;
          },
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
        },
      },
    },
  });

  mock.module("@/lib/rate-limit", {
    namedExports: {
      rateLimiters: { api: () => ({ success: true }) },
      getClientIp: (req: Request) =>
        req.headers.get("x-forwarded-for") ?? "test-ip",
    },
  });

  mock.module("@/lib/storage/provider", {
    namedExports: {
      createDeliveryUrl: async (key: string, opts: unknown) => {
        state.signCalls.push({ key, opts });
        return state.signResult;
      },
      MAX_DELIVERY_TTL_SECONDS: 300,
      MIN_DELIVERY_TTL_SECONDS: 30,
      DEFAULT_DELIVERY_TTL_SECONDS: 60,
    },
  });

  const realLog = console.log;
  console.log = (...args: unknown[]) => {
    state.logs.push(args.map(String).join(" "));
    void realLog;
  };

  GET = (await import("../app/api/download/[productId]/route.ts")).GET as typeof GET;
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let ip = 0;
function request(url: string): Request {
  ip++;
  return new Request(url, {
    headers: { "x-forwarded-for": `10.1.${(ip >> 8) & 255}.${ip & 255}` },
  });
}

const product = (
  fileScanStatus = "SAFE",
  fileKey: string | null = KEY,
  fileScanKey: string | null = KEY
): ProductRow => ({ id: "prod_1", name: "Arabic Templates Pack", fileKey, fileScanStatus, fileScanKey });

/** Email channel: bare productId + ?orderId= */
const byOrder = (productId = "prod_1", orderId = "order_1") =>
  GET(request(`https://saiflow.test/api/download/${productId}?orderId=${orderId}`), {
    params: Promise.resolve({ productId }),
  });

/** Success-page channel: the path param is a Stripe session id. */
const bySession = (sessionId = "cs_test_abc", qs = "") =>
  GET(request(`https://saiflow.test/api/download/${sessionId}${qs}`), {
    params: Promise.resolve({ productId: sessionId }),
  });

async function assertRefusedWithoutSigning(res: Response, status: number, code?: string) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}`);
  assert.equal(state.signCalls.length, 0, "a refusal must never sign anything");
  assert.equal(res.headers.get("location"), null, "a refusal must not redirect");
  const body = await res.text();
  assert.ok(!body.includes("signed.example.test"), "refusal leaked a signed URL");
  assert.ok(!body.includes("SECRET"), "refusal leaked a signature");
  assert.ok(!body.includes("utfs.io"), "refusal leaked a storage URL");
  if (code) assert.equal(JSON.parse(body).error, code);
}

/* ------------------------------------------------------------------ */
/* Purchase authorization — unchanged, and still first                 */
/* ------------------------------------------------------------------ */

describe("delivery: proof of purchase is still required", () => {
  test("no order at all is refused", async () => {
    reset();
    state.order = null;
    state.product = product();
    await assertRefusedWithoutSigning(await byOrder(), 403);
  });

  test("an order for a DIFFERENT product is refused", async () => {
    reset();
    // The order exists and is real, but belongs to another product.
    state.order = { id: "order_1", productId: "prod_OTHER" };
    state.product = product();
    await assertRefusedWithoutSigning(await byOrder("prod_1"), 403);
  });

  test("a bare productId with no orderId is refused", async () => {
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product();
    const res = await GET(request("https://saiflow.test/api/download/prod_1"), {
      params: Promise.resolve({ productId: "prod_1" }),
    });
    // Closes the unauthenticated enumeration hole: without an orderId the
    // email channel never even looks the order up.
    await assertRefusedWithoutSigning(res, 403);
  });

  test("an unknown session id is refused", async () => {
    reset();
    state.order = null;
    state.product = product();
    await assertRefusedWithoutSigning(await bySession(), 403);
  });

  test("authorization is evaluated before the product is loaded", async () => {
    reset();
    state.order = null;
    state.product = product();
    await byOrder();
    assert.equal(state.productSelect, null, "must refuse before touching the product");
  });
});

/* ------------------------------------------------------------------ */
/* The safety gate                                                     */
/* ------------------------------------------------------------------ */

describe("delivery: paying does not entitle a buyer to unsafe bytes", () => {
  const authorized = () => {
    state.order = { id: "order_1", productId: "prod_1" };
  };

  test("SAFE with a matching key delivers, exactly once", async () => {
    reset();
    authorized();
    state.product = product("SAFE", KEY, KEY);

    const res = await byOrder();
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), SIGNED_URL);
    assert.equal(state.signCalls.length, 1, "exactly one signing call");
    assert.equal(state.signCalls[0].key, KEY, "the DB-derived key, and no other");
    assert.deepEqual(state.signCalls[0].opts, { ttlSeconds: 300 });
  });

  test("PENDING_SCAN is refused", async () => {
    reset();
    authorized();
    state.product = product("PENDING_SCAN", KEY, null);
    await assertRefusedWithoutSigning(await byOrder(), 409, "file_not_available");
  });

  test("SCAN_ERROR is refused", async () => {
    reset();
    authorized();
    state.product = product("SCAN_ERROR", KEY, KEY);
    await assertRefusedWithoutSigning(await byOrder(), 409, "file_not_available");
  });

  test("UNSAFE is refused — a paid order is not a licence for malware", async () => {
    reset();
    authorized();
    state.product = product("UNSAFE", KEY, KEY);
    await assertRefusedWithoutSigning(await byOrder(), 409, "file_not_available");
  });

  test("SAFE bound to a DIFFERENT key is refused", async () => {
    reset();
    authorized();
    // Bought, then the seller replaced the file. The verdict describes bytes
    // this product no longer points at.
    state.product = product("SAFE", KEY, OTHER_KEY);
    await assertRefusedWithoutSigning(await byOrder(), 409, "file_not_available");
  });

  test("a null fileScanKey is refused", async () => {
    reset();
    authorized();
    state.product = product("SAFE", KEY, null);
    await assertRefusedWithoutSigning(await byOrder(), 409, "file_not_available");
  });

  test("a missing fileKey is refused — including the null === null trap", async () => {
    reset();
    authorized();
    state.product = product("SAFE", null, null);
    // Both null, so the key comparison alone would pass. The non-null clause
    // is what refuses.
    await assertRefusedWithoutSigning(await byOrder(), 409, "file_not_available");
  });

  test("an unknown or future scan status is refused", async () => {
    reset();
    authorized();
    state.product = product("QUARANTINED", KEY, KEY);
    await assertRefusedWithoutSigning(await byOrder(), 409, "file_not_available");
  });

  test("every non-deliverable shape refuses, exhaustively", async () => {
    const shapes: [string, string | null, string | null][] = [
      ["PENDING_SCAN", KEY, null],
      ["PENDING_SCAN", KEY, KEY],
      ["SCAN_ERROR", KEY, KEY],
      ["UNSAFE", KEY, KEY],
      ["SAFE", KEY, OTHER_KEY],
      ["SAFE", KEY, null],
      ["SAFE", null, null],
      ["SAFE", null, KEY],
      ["QUARANTINED", KEY, KEY],
      ["safe", KEY, KEY],
      ["", KEY, KEY],
    ];
    for (const [status, fk, fsk] of shapes) {
      reset();
      authorized();
      state.product = product(status, fk, fsk);
      const res = await byOrder();
      assert.equal(res.status, 409, `${status}/${fk}/${fsk} must refuse`);
      assert.equal(state.signCalls.length, 0, `${status}/${fk}/${fsk} signed`);
    }
  });

  test("the refusal does not disclose which state failed", async () => {
    const bodies: string[] = [];
    for (const status of ["PENDING_SCAN", "SCAN_ERROR", "UNSAFE"]) {
      reset();
      authorized();
      state.product = product(status, KEY, KEY);
      bodies.push(await (await byOrder()).text());
    }
    assert.equal(new Set(bodies).size, 1, "all three must answer identically");
    for (const b of bodies) {
      assert.ok(!/unsafe|malware|virus|pending|scan_error/i.test(b), b);
    }
  });

  test("a missing product is refused", async () => {
    reset();
    authorized();
    state.product = null;
    await assertRefusedWithoutSigning(await byOrder(), 404);
  });
});

/* ------------------------------------------------------------------ */
/* Legacy: no fallback to the old public URL                           */
/* ------------------------------------------------------------------ */

describe("delivery: legacy products refuse rather than fall back", () => {
  test("a legacy row with no fileKey is refused", async () => {
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    // Exactly the shape of a pre-Stage-B row: no key, never scanned.
    state.product = product("PENDING_SCAN", null, null);
    await assertRefusedWithoutSigning(await byOrder(), 409, "file_not_available");
  });

  test("the route never loads fileUrl at all", async () => {
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product();
    await byOrder();
    assert.ok(state.productSelect, "the product must be selected explicitly");
    assert.ok(
      !("fileUrl" in (state.productSelect as object)),
      "fileUrl must not be selected — it cannot leak what it never loads"
    );
    for (const col of ["fileKey", "fileScanStatus", "fileScanKey"]) {
      assert.equal(
        (state.productSelect as Record<string, boolean>)[col],
        true,
        `${col} must be selected for the gate`
      );
    }
  });

  test("no response can carry a public storage URL", async () => {
    // Even if a row somehow still had one, it is never selected, so there is
    // nothing to emit. This proves the response surface, not just the query.
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = { ...product(), ...({ fileUrl: LEGACY_PUBLIC_URL } as object) };
    const res = await byOrder();
    const body = await res.text();
    assert.ok(!body.includes("utfs.io"), "a storage URL reached the client");
  });
});

/* ------------------------------------------------------------------ */
/* The JSON channel hands back a path, not a credential                */
/* ------------------------------------------------------------------ */

describe("delivery: the success-page channel serialises no URL", () => {
  test("JSON returns an application path, and signs nothing", async () => {
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product();

    const res = await bySession("cs_test_abc", "?format=json");
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.productName, "Arabic Templates Pack");
    assert.equal(body.downloadUrl, "/api/download/cs_test_abc");
    assert.ok(body.downloadUrl.startsWith("/"), "must be a relative path");
    assert.equal(
      state.signCalls.length,
      0,
      "the JSON channel must not mint a credential — the browser re-enters the gates"
    );
  });

  test("the JSON path carries no signed or storage URL", async () => {
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product();
    const raw = await (await bySession("cs_test_abc", "?format=json")).text();
    assert.ok(!raw.includes("signed.example.test"));
    assert.ok(!raw.includes("SECRET"));
    assert.ok(!raw.includes("utfs.io"));
    assert.ok(!raw.includes("ufs.sh"));
  });

  test("the email channel's JSON path preserves the orderId", async () => {
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product();
    const res = await GET(
      request("https://saiflow.test/api/download/prod_1?orderId=order_1&format=json"),
      { params: Promise.resolve({ productId: "prod_1" }) }
    );
    const body = await res.json();
    assert.equal(body.downloadUrl, "/api/download/prod_1?orderId=order_1");
  });

  test("the JSON channel still enforces both gates", async () => {
    // Unauthorized
    reset();
    state.order = null;
    state.product = product();
    await assertRefusedWithoutSigning(await bySession("cs_x", "?format=json"), 403);

    // Authorized but unsafe
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product("UNSAFE", KEY, KEY);
    await assertRefusedWithoutSigning(
      await bySession("cs_x", "?format=json"),
      409,
      "file_not_available"
    );
  });

  test("the returned path is rebuilt, not echoed from the request", async () => {
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product();
    const res = await GET(
      request(
        "https://saiflow.test/api/download/prod_1?orderId=order_1&format=json&evil=%3Cscript%3E&redirect=https://evil.test"
      ),
      { params: Promise.resolve({ productId: "prod_1" }) }
    );
    const body = await res.json();
    assert.equal(body.downloadUrl, "/api/download/prod_1?orderId=order_1");
    assert.ok(!body.downloadUrl.includes("evil"), "no client parameter rides along");
    assert.ok(!body.downloadUrl.includes("format=json"), "no recursion into JSON");
  });
});

/* ------------------------------------------------------------------ */
/* Client input cannot influence the outcome                           */
/* ------------------------------------------------------------------ */

describe("delivery: the buyer controls nothing but the identifiers", () => {
  const authorizedSafe = () => {
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product();
  };

  test("a client-supplied storage key is ignored", async () => {
    reset();
    authorizedSafe();
    const res = await GET(
      request(
        "https://saiflow.test/api/download/prod_1?orderId=order_1&key=EVIL_KEY&fileKey=EVIL_KEY"
      ),
      { params: Promise.resolve({ productId: "prod_1" }) }
    );
    assert.equal(res.status, 302);
    assert.equal(state.signCalls[0].key, KEY, "the row's key, not the client's");
    assert.notEqual(state.signCalls[0].key, "EVIL_KEY");
  });

  test("a client-supplied file URL is ignored", async () => {
    reset();
    authorizedSafe();
    const res = await GET(
      request(
        "https://saiflow.test/api/download/prod_1?orderId=order_1&fileUrl=https://evil.test/x&url=https://evil.test/y"
      ),
      { params: Promise.resolve({ productId: "prod_1" }) }
    );
    assert.equal(res.headers.get("location"), SIGNED_URL, "must not redirect anywhere else");
  });

  test("a client-supplied scan status cannot unlock an unsafe file", async () => {
    reset();
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product("UNSAFE", KEY, KEY);
    const res = await GET(
      request(
        "https://saiflow.test/api/download/prod_1?orderId=order_1&fileScanStatus=SAFE&fileScanKey=" +
          KEY +
          "&isDeliverableSafe=true&force=1"
      ),
      { params: Promise.resolve({ productId: "prod_1" }) }
    );
    await assertRefusedWithoutSigning(res, 409, "file_not_available");
  });

  test("the only query parameters read are orderId and format", () => {
    const s = routeSrc();
    const reads = s.match(/searchParams\.get\("([^"]+)"\)/g) ?? [];
    assert.deepEqual(
      reads.sort(),
      ['searchParams.get("format")', 'searchParams.get("orderId")'],
      "no other request parameter may be read"
    );
  });
});

/* ------------------------------------------------------------------ */
/* Signing failure, headers, and leakage                               */
/* ------------------------------------------------------------------ */

describe("delivery: failure is failure, and nothing leaks", () => {
  const authorizedSafe = () => {
    state.order = { id: "order_1", productId: "prod_1" };
    state.product = product();
  };

  test("a signing failure fails closed with a category only", async () => {
    for (const reason of ["storage_unconfigured", "sign_failed", "invalid_key"]) {
      reset();
      authorizedSafe();
      state.signResult = { ok: false, reason };

      const res = await byOrder();
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("location"), null);
      const body = await res.json();
      assert.equal(body.error, "delivery_unavailable");
      assert.equal(body.reason, reason);
      assert.ok(!JSON.stringify(body).includes("signed.example.test"));
    }
  });

  test("the redirect sets no-store and no-referrer", async () => {
    reset();
    authorizedSafe();
    const res = await byOrder();
    assert.equal(res.headers.get("cache-control"), "no-store, must-revalidate");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  });

  test("the signed URL appears only as the redirect destination", async () => {
    reset();
    authorizedSafe();
    const res = await byOrder();
    assert.equal(res.headers.get("location"), SIGNED_URL);
    assert.ok(!(await res.text()).includes("SECRET"), "the body must not carry it");
  });

  test("nothing logged contains the signed URL or the key", async () => {
    reset();
    authorizedSafe();
    await byOrder();
    assert.ok(state.logs.length > 0, "the authorized download should be recorded");
    for (const line of state.logs) {
      assert.ok(!line.includes("signed.example.test"), `URL in log: ${line}`);
      assert.ok(!line.includes("SECRET"), `signature in log: ${line}`);
      assert.ok(!line.includes(KEY), `storage key in log: ${line}`);
    }
  });

  test("the error handler never echoes the cause", () => {
    assert.ok(
      /\(error as Error\)\?\.name/.test(routeSrc()),
      "only the error name may be logged"
    );
  });

  test("the TTL requested is the reviewed D1 ceiling, not an invented value", () => {
    const s = routeSrc();
    assert.ok(
      /DOWNLOAD_TTL_SECONDS = MAX_DELIVERY_TTL_SECONDS/.test(s),
      "the TTL must be expressed in terms of the D1 policy"
    );
    // And that ceiling is what D1 actually declares.
    const provider = read("../lib/storage/provider.ts");
    assert.ok(provider.includes("export const MAX_DELIVERY_TTL_SECONDS = 300;"));
  });
});

/* ------------------------------------------------------------------ */
/* Source-level guarantees                                             */
/* ------------------------------------------------------------------ */

describe("delivery: the old raw-URL paths are gone", () => {
  test("no redirect to product.fileUrl survives", () => {
    const s = routeSrc();
    assert.ok(!/NextResponse\.redirect\(product\.fileUrl\)/.test(s));
    assert.ok(!/downloadUrl: product\.fileUrl/.test(s));

    // Comments are stripped first: the header deliberately DOCUMENTS that the
    // old fileUrl delivery was removed, and a naive text search would flag
    // that explanation as the very thing it describes. What must be absent is
    // any executable reference.
    const code = s
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.ok(
      !/product\.fileUrl/.test(code),
      "fileUrl must not be referenced in executable code"
    );
    assert.ok(
      !/fileUrl:\s*true/.test(code),
      "fileUrl must not be selected from the database"
    );
  });

  test("it imports and uses both reviewed authorities", () => {
    const s = routeSrc();
    assert.ok(s.includes('import { isDeliverableSafe } from "@/lib/file-safety"'));
    assert.ok(s.includes("createDeliveryUrl"));
    assert.ok(/if \(!isDeliverableSafe\(product\)\)/.test(s));
  });

  test("it does not re-derive the predicate", () => {
    const s = routeSrc();
    assert.ok(!/fileScanStatus\s*===/.test(s), "must not test the status itself");
    assert.ok(!/fileScanKey\s*===/.test(s), "must not compare the keys itself");
    assert.ok(!s.includes("deliverableGateReason"), "one authority, not two");
  });

  test("signing happens after BOTH gates, by position", () => {
    const s = routeSrc();
    const auth = s.indexOf("if (!order)");
    const gate = s.indexOf("if (!isDeliverableSafe(product))");
    const sign = s.indexOf("await createDeliveryUrl(");
    assert.ok(auth > 0 && gate > auth, "the safety gate must follow authorization");
    assert.ok(sign > gate, "signing must follow the safety gate");
  });

  test("D3 checkout, D2 inspection and the scanner are untouched", () => {
    const checkout = read("../app/api/checkout/route.ts");
    assert.ok(checkout.includes("isDeliverableSafe(product)"), "D3 intact");
    assert.ok(!checkout.includes("createDeliveryUrl"), "checkout still does not sign");

    for (const f of [
      "../app/api/admin/inspect/[productId]/route.ts",
      "../app/api/products/[id]/inspect/route.ts",
    ]) {
      assert.ok(read(f).includes("inspectProduct("), "D2 intact");
    }

    for (const f of ["../lib/scan/run.ts", "../lib/scan/policy.ts"]) {
      assert.ok(!read(f).includes("createDeliveryUrl"), `${f} must not deliver`);
    }
  });

  test("the download route triggers no scan", () => {
    const s = routeSrc();
    assert.ok(!s.includes("scanFileAsset"));
    assert.ok(!s.includes("internal/scan"));
  });
});
