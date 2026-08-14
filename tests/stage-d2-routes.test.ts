/**
 * Stage D2 — the inspection routes, executed.
 *
 * The first draft of these tests asserted source text and statement ordering.
 * That proves a guard is written; it does not prove a request hits it. These
 * call the real exported `GET` handlers with a real Request and read the real
 * Response, so a refusal here is a refusal the runtime actually performs.
 *
 * Mocked: the session (next-auth), the database (Prisma), the auth options
 * module, the rate limiter, and the signer. Everything else is real — the
 * authority check reads ADMIN_EMAILS through the real `isAdminEmail`, and the
 * policy and gate-reason functions are the real ones. No network call is made
 * and nothing is ever really signed.
 *
 * The rate limiter is mocked for a mechanical reason worth recording:
 * lib/rate-limit.ts starts a module-level `setInterval` that is never
 * `unref`'d, so merely importing it keeps Node's event loop alive and this
 * process would never exit. That is a pre-existing property of that module,
 * not something D2 introduced, and it is left alone here. That both routes
 * actually call the limiter is asserted separately, against source, in
 * tests/stage-d2-inspection.test.ts.
 *
 * Each request still carries a distinct client IP, so the doubles cannot mask
 * a dependency between tests.
 */

import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ADMIN_EMAIL = "founder@saiflow.test";
const OTHER_EMAIL = "someone@example.test";
const KEY = "abc123XY_key-one";
const OTHER_KEY = "zzz999QQ_key-two";

process.env.ADMIN_EMAILS = ADMIN_EMAIL;

/* ------------------------------------------------------------------ */
/* Test doubles                                                        */
/* ------------------------------------------------------------------ */

interface ProductRow {
  id: string;
  fileKey: string | null;
  fileScanStatus: string;
  fileScanKey: string | null;
}

const state: {
  session: unknown;
  product: ProductRow | null;
  signResult: unknown;
  findUniqueArgs: unknown[];
  findFirstArgs: unknown[];
  signCalls: { key: string; opts: unknown }[];
  logs: string[];
} = {
  session: null,
  product: null,
  signResult: null,
  findUniqueArgs: [],
  findFirstArgs: [],
  signCalls: [],
  logs: [],
};

function reset() {
  state.session = null;
  state.product = null;
  state.signResult = {
    ok: true,
    url: "https://signed.example.test/f/abc?sig=SECRET",
    expiresAt: new Date("2026-01-01T00:00:00Z"),
  };
  state.findUniqueArgs = [];
  state.findFirstArgs = [];
  state.signCalls = [];
  state.logs = [];
}
reset();

/** The URL a successful sign returns. Nothing but a redirect may contain it. */
const SIGNED_URL = "https://signed.example.test/f/abc?sig=SECRET";

let adminGET: (req: Request, ctx: { params: Promise<{ productId: string }> }) => Promise<Response>;
let sellerGET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  mock.module("next-auth", {
    namedExports: { getServerSession: async () => state.session },
  });

  // The real module pulls in the Prisma adapter, bcrypt and env validation.
  // None of that is under test; the session is mocked above.
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, {
    namedExports: { authOptions: {} },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        product: {
          findUnique: async (args: unknown) => {
            state.findUniqueArgs.push(args);
            return state.product;
          },
          findFirst: async (args: unknown) => {
            state.findFirstArgs.push(args);
            return state.product;
          },
          // lib/file-safety.ts builds SAFE_DELIVERABLE_WHERE at module load
          // from a Prisma field reference. Absent it, importing the route
          // throws before any assertion runs.
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
        },
      },
    },
  });

  // See the header: importing the real module would leave a live interval
  // holding the event loop open. Always-allow, so no test can be rate-limited.
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
      MIN_DELIVERY_TTL_SECONDS: 30,
      MAX_DELIVERY_TTL_SECONDS: 300,
      DEFAULT_DELIVERY_TTL_SECONDS: 60,
    },
  });

  // Capture logs so we can assert no signed URL is ever written to one.
  const realLog = console.log;
  console.log = (...args: unknown[]) => {
    state.logs.push(args.map(String).join(" "));
    void realLog;
  };

  adminGET = (
    await import("../app/api/admin/inspect/[productId]/route.ts")
  ).GET as typeof adminGET;
  sellerGET = (
    await import("../app/api/products/[id]/inspect/route.ts")
  ).GET as typeof sellerGET;
});

/* ------------------------------------------------------------------ */
/* Request helpers                                                     */
/* ------------------------------------------------------------------ */

let ipCounter = 0;
/** A fresh client IP per request keeps the real rate limiter out of the way. */
function request(url = "https://saiflow.test/api/x"): Request {
  ipCounter++;
  return new Request(url, {
    headers: { "x-forwarded-for": `10.0.${(ipCounter >> 8) & 255}.${ipCounter & 255}` },
  });
}

const asAdmin = () => ({ user: { email: ADMIN_EMAIL, id: "admin_1" } });
const asUser = (email = OTHER_EMAIL) => ({ user: { email, id: "user_1" } });

const product = (
  fileScanStatus: string,
  fileKey: string | null = KEY,
  fileScanKey: string | null = KEY
): ProductRow => ({ id: "prod_1", fileKey, fileScanStatus, fileScanKey });

const callAdmin = (productId = "prod_1") =>
  adminGET(request(), { params: Promise.resolve({ productId }) });

const callSeller = (id = "prod_1") =>
  sellerGET(request(), { params: Promise.resolve({ id }) });

/** Assert a response refused, and leaked nothing. */
async function assertRefused(res: Response, status: number, code?: string) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}`);
  assert.equal(res.headers.get("location"), null, "a refusal must not redirect");
  const body = await res.text();
  assert.ok(!body.includes("signed.example.test"), "refusal leaked the URL");
  assert.ok(!body.includes("SECRET"), "refusal leaked the signature");
  if (code) assert.equal(JSON.parse(body).error, code);
  assert.equal(state.signCalls.length, 0, "a refusal must not sign anything");
}

/* ------------------------------------------------------------------ */
/* ADMIN ROUTE                                                         */
/* ------------------------------------------------------------------ */

describe("admin inspection route: authorisation", () => {
  test("1. an anonymous request is refused", async () => {
    reset();
    state.session = null;
    state.product = product("SAFE");
    await assertRefused(await callAdmin(), 403, "Forbidden");
    assert.equal(state.findUniqueArgs.length, 0, "must refuse before querying");
  });

  test("2. an authenticated non-admin is refused", async () => {
    reset();
    state.session = asUser();
    state.product = product("SAFE");
    await assertRefused(await callAdmin(), 403, "Forbidden");
    assert.equal(state.findUniqueArgs.length, 0, "must refuse before querying");
  });

  test("2b. a session with no email is refused", async () => {
    reset();
    state.session = { user: { id: "x" } };
    state.product = product("SAFE");
    await assertRefused(await callAdmin(), 403);
  });

  test("2c. admin matching is case-insensitive, as isAdminEmail defines", async () => {
    reset();
    state.session = { user: { email: ADMIN_EMAIL.toUpperCase(), id: "a" } };
    state.product = product("SAFE");
    const res = await callAdmin();
    assert.equal(res.status, 302);
  });

  test("3. a missing product is refused", async () => {
    reset();
    state.session = asAdmin();
    state.product = null;
    await assertRefused(await callAdmin(), 404, "not_found");
  });

  test("4. a product with no file key is refused", async () => {
    reset();
    state.session = asAdmin();
    state.product = product("PENDING_SCAN", null, null);
    await assertRefused(await callAdmin(), 404, "no_file");
  });
});

describe("admin inspection route: scan states", () => {
  test("5. SAFE is permitted and redirects to the signed URL", async () => {
    reset();
    state.session = asAdmin();
    state.product = product("SAFE");

    const res = await callAdmin();
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), SIGNED_URL);
    assert.equal(state.signCalls.length, 1);
    assert.equal(state.signCalls[0].key, KEY);
    assert.deepEqual(state.signCalls[0].opts, { ttlSeconds: 60 });
  });

  for (const [label, status] of [
    ["6. PENDING_SCAN", "PENDING_SCAN"],
    ["7. SCAN_ERROR", "SCAN_ERROR"],
  ] as const) {
    test(`${label} is permitted as UNVERIFIED`, async () => {
      reset();
      state.session = asAdmin();
      state.product = product(status, KEY, status === "PENDING_SCAN" ? null : KEY);

      const res = await callAdmin();
      assert.equal(res.status, 302, `${label} must be openable by the founder`);
      assert.equal(res.headers.get("location"), SIGNED_URL);
      assert.ok(
        state.logs.some((l) => l.includes("verification=unverified")),
        "must be recorded as unverified, never as safe"
      );
    });
  }

  test("8. a stale key binding is permitted as UNVERIFIED", async () => {
    reset();
    state.session = asAdmin();
    // SAFE verdict, but issued for a file this product no longer points at.
    state.product = product("SAFE", KEY, OTHER_KEY);

    const res = await callAdmin();
    assert.equal(res.status, 302);
    assert.ok(state.logs.some((l) => l.includes("verification=unverified")));
    assert.ok(state.logs.some((l) => l.includes("scan=scan_key_mismatch")));
    // The key signed is the ATTACHED one, never the one the verdict names.
    assert.equal(state.signCalls[0].key, KEY);
  });

  test("9. UNSAFE is refused", async () => {
    reset();
    state.session = asAdmin();
    state.product = product("UNSAFE");
    await assertRefused(await callAdmin(), 403, "unsafe");
  });

  test("9b. UNSAFE stays refused however the request is dressed up", async () => {
    // The removed override lived in the query string. Nothing there can
    // change the answer any more.
    for (const qs of [
      "?acknowledgeUnsafe=1",
      "?ack=1",
      "?confirm=true",
      "?force=1",
      "?unsafe=allow",
    ]) {
      reset();
      state.session = asAdmin();
      state.product = product("UNSAFE");
      const res = await adminGET(request(`https://saiflow.test/api/x${qs}`), {
        params: Promise.resolve({ productId: "prod_1" }),
      });
      assert.equal(res.status, 403, `${qs} must not unlock an unsafe file`);
      assert.equal(state.signCalls.length, 0, `${qs} caused a signature`);
    }
  });

  test("10. an unknown scan state is refused", async () => {
    reset();
    state.session = asAdmin();
    // A status a later migration might add, reaching a build that predates it.
    state.product = product("QUARANTINED");
    await assertRefused(await callAdmin(), 409, "unknown_state");
  });
});

describe("admin inspection route: failure and inputs", () => {
  test("11. a signing failure fails closed and leaks nothing", async () => {
    reset();
    state.session = asAdmin();
    state.product = product("SAFE");
    state.signResult = { ok: false, reason: "storage_unconfigured" };

    const res = await callAdmin();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("location"), null);
    const body = await res.json();
    assert.equal(body.error, "delivery_unavailable");
    assert.equal(body.reason, "storage_unconfigured");
    assert.ok(!JSON.stringify(body).includes("signed.example.test"));
  });

  test("12. the client cannot supply or replace the storage key", async () => {
    reset();
    state.session = asAdmin();
    state.product = product("SAFE");

    const res = await adminGET(
      request(
        "https://saiflow.test/api/x?key=EVIL_KEY&fileKey=EVIL_KEY" +
          "&url=https://evil.test/f/x&path=/etc/passwd"
      ),
      { params: Promise.resolve({ productId: "prod_1" }) }
    );

    assert.equal(res.status, 302);
    // The key signed is the row's, regardless of what the client asked for.
    assert.equal(state.signCalls.length, 1);
    assert.equal(state.signCalls[0].key, KEY);
    assert.notEqual(state.signCalls[0].key, "EVIL_KEY");
  });

  test("the product is looked up by the path id alone", async () => {
    reset();
    state.session = asAdmin();
    state.product = product("SAFE");
    await callAdmin("prod_42");

    const args = state.findUniqueArgs[0] as { where: { id: string }; select: Record<string, boolean> };
    assert.deepEqual(args.where, { id: "prod_42" });
    assert.ok(!("fileUrl" in args.select), "fileUrl must not be selected");
    assert.equal(args.select.fileKey, true);
  });
});

/* ------------------------------------------------------------------ */
/* SELLER ROUTE                                                        */
/* ------------------------------------------------------------------ */

describe("seller inspection route: authorisation", () => {
  test("1. an anonymous request is refused", async () => {
    reset();
    state.session = null;
    state.product = product("SAFE");
    await assertRefused(await callSeller(), 401, "Unauthorized");
    assert.equal(state.findFirstArgs.length, 0, "must refuse before querying");
  });

  test("2. a signed-in user outside the shop is refused", async () => {
    reset();
    state.session = asUser();
    // Membership is part of the WHERE, so a non-member's query finds nothing.
    state.product = null;
    await assertRefused(await callSeller(), 404, "not_found");
  });

  test("3. a member of ANOTHER shop is refused, indistinguishably", async () => {
    reset();
    state.session = asUser("member@othershop.test");
    state.product = null;
    const res = await callSeller();
    // Same status and same body as an id that does not exist: a member of one
    // shop cannot probe which product ids belong to another.
    await assertRefused(res, 404, "not_found");
  });

  test("the membership constraint is in the query, not applied after it", async () => {
    reset();
    state.session = asUser();
    state.product = null;
    await callSeller("prod_9");

    const args = state.findFirstArgs[0] as {
      where: { id: string; shop: { shopUsers: { some: unknown } } };
      select: Record<string, boolean>;
    };
    assert.equal(args.where.id, "prod_9");
    assert.ok(args.where.shop?.shopUsers?.some, "membership must be in the WHERE");
    assert.equal(
      JSON.stringify(args.where).includes(OTHER_EMAIL),
      true,
      "scoped to the requesting user"
    );
    assert.ok(!("fileUrl" in args.select), "fileUrl must not be selected");
  });

  test("even an admin gets no shortcut on the seller route", async () => {
    reset();
    state.session = asAdmin();
    state.product = null; // not a member of this shop
    await assertRefused(await callSeller(), 404);
  });
});

describe("seller inspection route: SAFE only", () => {
  test("4. a shop member with a SAFE, key-matched file is permitted", async () => {
    reset();
    state.session = asUser();
    state.product = product("SAFE");

    const res = await callSeller();
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), SIGNED_URL);
    assert.equal(state.signCalls[0].key, KEY);
    assert.ok(state.logs.some((l) => l.includes("verification=verified")));
  });

  test("5. PENDING_SCAN is refused", async () => {
    reset();
    state.session = asUser();
    state.product = product("PENDING_SCAN", KEY, null);
    await assertRefused(await callSeller(), 409, "unverified");
  });

  test("6. SCAN_ERROR is refused", async () => {
    reset();
    state.session = asUser();
    state.product = product("SCAN_ERROR");
    await assertRefused(await callSeller(), 409, "unverified");
  });

  test("7. a stale key binding is refused", async () => {
    reset();
    state.session = asUser();
    state.product = product("SAFE", KEY, OTHER_KEY);
    await assertRefused(await callSeller(), 409, "unverified");
  });

  test("8. UNSAFE is refused", async () => {
    reset();
    state.session = asUser();
    state.product = product("UNSAFE");
    await assertRefused(await callSeller(), 403, "unsafe");
  });

  test("8b. no query parameter unlocks anything for a seller", async () => {
    for (const status of ["UNSAFE", "PENDING_SCAN", "SCAN_ERROR"]) {
      for (const qs of ["?acknowledgeUnsafe=1", "?ack=1", "?force=1"]) {
        reset();
        state.session = asUser();
        state.product = product(status);
        const res = await sellerGET(request(`https://saiflow.test/api/x${qs}`), {
          params: Promise.resolve({ id: "prod_1" }),
        });
        assert.ok(res.status >= 400, `${status}${qs} must refuse`);
        assert.equal(state.signCalls.length, 0, `${status}${qs} signed something`);
      }
    }
  });

  test("9. an unknown scan state is refused", async () => {
    reset();
    state.session = asUser();
    state.product = product("QUARANTINED");
    await assertRefused(await callSeller(), 409, "unknown_state");
  });

  test("9b. a missing file key is refused", async () => {
    reset();
    state.session = asUser();
    state.product = product("SAFE", null, null);
    await assertRefused(await callSeller(), 404, "no_file");
  });

  test("10. a signing failure fails closed", async () => {
    reset();
    state.session = asUser();
    state.product = product("SAFE");
    state.signResult = { ok: false, reason: "sign_failed" };

    const res = await callSeller();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("location"), null);
    assert.equal((await res.json()).error, "delivery_unavailable");
  });

  test("11. the client cannot supply a storage key", async () => {
    reset();
    state.session = asUser();
    state.product = product("SAFE");

    const res = await sellerGET(
      request("https://saiflow.test/api/x?key=EVIL_KEY&fileKey=EVIL_KEY"),
      { params: Promise.resolve({ id: "prod_1" }) }
    );

    assert.equal(res.status, 302);
    assert.equal(state.signCalls[0].key, KEY);
  });
});

/* ------------------------------------------------------------------ */
/* Redirect security, observed on real responses                       */
/* ------------------------------------------------------------------ */

describe("redirect security", () => {
  const permitted: [string, () => Promise<Response>][] = [
    ["admin", async () => {
      reset();
      state.session = asAdmin();
      state.product = product("SAFE");
      return callAdmin();
    }],
    ["seller", async () => {
      reset();
      state.session = asUser();
      state.product = product("SAFE");
      return callSeller();
    }],
  ];

  for (const [name, run] of permitted) {
    test(`${name}: the URL appears only as the redirect destination`, async () => {
      const res = await run();
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), SIGNED_URL);
      const body = await res.text();
      assert.ok(!body.includes("SECRET"), "the body must not carry the URL");
    });

    test(`${name}: no-store and no-referrer are set`, async () => {
      const res = await run();
      assert.equal(res.headers.get("cache-control"), "no-store, must-revalidate");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    });

    test(`${name}: the TTL requested is 60 seconds`, async () => {
      await run();
      assert.deepEqual(state.signCalls[0].opts, { ttlSeconds: 60 });
    });

    test(`${name}: nothing logged contains the signed URL`, async () => {
      await run();
      assert.ok(state.logs.length > 0, "the inspection should be recorded");
      for (const line of state.logs) {
        assert.ok(!line.includes("signed.example.test"), `URL in log: ${line}`);
        assert.ok(!line.includes("SECRET"), `signature in log: ${line}`);
      }
    });
  }
});
