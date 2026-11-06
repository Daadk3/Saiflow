/**
 * Hosted-access products (e.g. an AI agent the seller hosts). Synthetic data
 * only: no database, no network, no real credentials.
 *
 * What must hold:
 * - Public visitors never see the access link or instructions: no public
 *   page or API selects them, and the delivery page needs proof of purchase.
 * - Unpaid users and other buyers cannot open the delivery; PaymentSession is
 *   never consulted, only the persisted Order, on every request.
 * - A verified buyer opens only their own purchased hosted product.
 * - Pending or rejected products can neither be bought nor delivered.
 * - Scanned-file products keep every existing gate.
 * - Preview with production orders (or production with test orders) delivers
 *   nothing.
 * - The link and instructions rules refuse SSRF targets, open-redirect
 *   shapes, and secrets.
 */
import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

type Validate = typeof import("../lib/hosted-access/validate.ts");
type Authorize = typeof import("../lib/hosted-access/authorize.ts");
type Sellable = typeof import("../lib/sellable.ts");
type Links = typeof import("../lib/download-links.ts");
let v: Validate;
let a: Authorize;
let sellable: Sellable;
let links: Links;

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        product: { fields: { fileKey: { _toFieldRef: "Product.fileKey" } } },
        productDeliverable: { fields: { fileKey: { _toFieldRef: "ProductDeliverable.fileKey" } } },
      },
    },
  });
  mock.module("@/lib/notify", { namedExports: { notifyAdminsProductReadyForReview: async () => [] } });
  v = await import("../lib/hosted-access/validate.ts");
  a = await import("../lib/hosted-access/authorize.ts");
  sellable = await import("../lib/sellable.ts");
  links = await import("../lib/download-links.ts");
});

/* ------------------------------------------------------------------ */
/* The link and instructions rules                                     */
/* ------------------------------------------------------------------ */

describe("validateHostedUrl", () => {
  test("accepts ordinary public https links and normalises them", () => {
    for (const url of [
      "https://agent.example-clinic.com/chat",
      "https://chatgpt.com/g/g-abc123-clinic-helper",
      "https://huggingface.co/spaces/someone/agent?lang=ar",
      "https://my-agent.vercel.app/",
    ]) {
      const r = v.validateHostedUrl(url);
      assert.ok(r.ok, url);
    }
    const r = v.validateHostedUrl("  HTTPS://Agent.Example.com/x  ");
    assert.deepEqual(r, { ok: true, value: "https://agent.example.com/x" });
  });

  const refused: Array<[string, string]> = [
    ["", "missing"],
    ["http://agent.example.com", "not_https"],
    ["javascript:alert(1)", "not_https"],
    ["data:text/html,hi", "not_https"],
    ["ftp://agent.example.com", "not_https"],
    ["agent.example.com", "malformed"],
    ["https://agent.example.com/a b", "malformed"],
    ["https://user:pass@agent.example.com", "credentials_in_url"],
    ["https://agent.example.com:8443/", "non_default_port"],
    ["https://127.0.0.1/", "ip_address"],
    ["https://169.254.169.254/latest/meta-data", "ip_address"],
    ["https://[::1]/", "ip_address"],
    ["https://0x7f000001/", "ip_address"],
    ["https://2130706433/", "ip_address"],
    ["https://localhost/", "internal_host"],
    ["https://agent.localhost/", "internal_host"],
    ["https://db.internal/", "internal_host"],
    ["https://printer.local/", "internal_host"],
    ["https://intranet/", "internal_host"],
    ["https://www.saiflow.io/api/download/x", "saiflow_host"],
    ["https://saiflow.io/", "saiflow_host"],
    ["https://bit.ly/abc", "shortener"],
    ["https://agent.example.com/?token=abc", "secret_in_url"],
    ["https://agent.example.com/?api_key=abc", "secret_in_url"],
    ["https://agent.example.com/?X-Amz-Signature=abc", "secret_in_url"],
    ["https://agent.example.com/#access_token=abc", "secret_in_url"],
  ];
  for (const [url, problem] of refused) {
    test(`refuses ${url || "(empty)"} as ${problem}`, () => {
      assert.deepEqual(v.validateHostedUrl(url), { ok: false, problem });
    });
  }

  test("refuses non-strings and over-long links", () => {
    assert.equal(v.validateHostedUrl(undefined).ok, false);
    assert.equal(v.validateHostedUrl(42).ok, false);
    assert.deepEqual(v.validateHostedUrl(`https://a.example.com/${"x".repeat(2100)}`), { ok: false, problem: "too_long" });
  });
});

describe("validateAccessInstructions", () => {
  test("empty is null; ordinary guidance passes, Arabic and English", () => {
    assert.deepEqual(v.validateAccessInstructions(undefined), { ok: true, value: null });
    assert.deepEqual(v.validateAccessInstructions("   "), { ok: true, value: null });
    for (const text of [
      "Open the link and sign in with the email you bought with.",
      "افتح الرابط وسجّل الدخول بالبريد الذي اشتريت به.",
      "Do not enter patient information into the agent.",
      "Support hours: 9am to 5pm, Sunday to Thursday.",
    ]) {
      assert.equal(v.validateAccessInstructions(text).ok, true, text);
    }
  });

  const refused: Array<[string, string]> = [
    ["Go to https://other.example.com", "contains_link"],
    ["visit www.other.example.com", "contains_link"],
    ["Password: hunter22", "looks_like_password"],
    ["username: clinic-admin", "looks_like_password"],
    ["كلمة المرور: 123456", "looks_like_password"],
    ["Use this API key with the agent", "looks_like_api_key"],
    ["key sk-abcdefghijklmnop1234", "looks_like_api_key"],
    ["AKIAABCDEFGHIJKLMNOP", "looks_like_api_key"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc", "looks_like_api_key"],
    ["Card 4111 1111 1111 1111", "looks_like_payment_details"],
    ["Pay to SA0380000000608010167519", "looks_like_payment_details"],
    ["Patient ID: 99812", "looks_like_personal_id"],
    ["MRN 556677", "looks_like_personal_id"],
    ["National ID 1012345678", "looks_like_personal_id"],
  ];
  for (const [text, problem] of refused) {
    test(`refuses "${text}" as ${problem}`, () => {
      assert.deepEqual(v.validateAccessInstructions(text), { ok: false, problem });
    });
  }

  test("over-long instructions are refused", () => {
    assert.deepEqual(v.validateAccessInstructions("a ".repeat(600)), { ok: false, problem: "too_long" });
  });

  test("every refusal has wording in both languages", () => {
    for (const [code, message] of Object.entries(v.HOSTED_ACCESS_PROBLEM_MESSAGES)) {
      assert.ok(message.en.length > 10 && message.ar.length > 10, code);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Delivery authorisation                                              */
/* ------------------------------------------------------------------ */

const SECRET = "synthetic-test-secret";
const REF = "3f2b1c9e-8a7d-4e6f-9b0c-1d2e3f4a5b6c";
const NOW = new Date("2026-11-05T12:00:00Z");
const BUYER = "buyer@example.test";

type OrderRow = import("../lib/hosted-access/authorize.ts").HostedOrderRow;
type ProductRow = import("../lib/hosted-access/authorize.ts").HostedProductRow;

function order(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order_1",
    productId: "prod_hosted",
    customerEmail: BUYER,
    paymentProvider: "GEIDEA",
    paymentEnvironment: "PRODUCTION",
    createdAt: new Date("2026-11-04T12:00:00Z"),
    ...over,
  };
}

function hostedProduct(over: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "prod_hosted",
    name: "Clinic booking agent",
    deliveryType: "HOSTED_ACCESS",
    moderationStatus: "APPROVED",
    shop: { isActive: true, name: "Synthetic Store" },
    hostedAccess: { accessUrl: "https://agent.example.com/start", instructions: "Sign in with the email you bought with." },
    ...over,
  };
}

function deps(over: {
  orders?: OrderRow[];
  products?: ProductRow[];
  email?: string | null;
  admins?: string[];
  vercelEnv?: string;
} = {}) {
  const orders = over.orders ?? [order()];
  const products = over.products ?? [hostedProduct()];
  const calls: string[] = [];
  return {
    calls,
    deps: {
      findOrderByMerchantReference: async (ref: string) => {
        calls.push(`orderByRef:${ref}`);
        return ref === REF ? orders[0] ?? null : null;
      },
      findOrderById: async (id: string) => {
        calls.push(`orderById:${id}`);
        return orders.find((o) => o.id === id) ?? null;
      },
      findProduct: async (id: string) => {
        calls.push(`product:${id}`);
        return products.find((p) => p.id === id) ?? null;
      },
      sessionEmail: async () => over.email ?? null,
      isAdmin: (e: string) => (over.admins ?? []).includes(e),
      vercelEnv: over.vercelEnv ?? "production",
      receiptSecret: SECRET,
      now: NOW,
    },
  };
}

describe("public visitors and unpaid users get nothing", () => {
  test("no credential: refused before any lookup", async () => {
    const h = deps();
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted" }, h.deps), { ok: false, reason: "no_credential" });
    assert.deepEqual(h.calls, []);
  });

  test("two credentials at once are refused, not resolved", async () => {
    const h = deps({ email: BUYER });
    const r = await a.authorizeHostedAccess({ productId: "prod_hosted", ref: REF, purchase: "order_1" }, h.deps);
    assert.deepEqual(r, { ok: false, reason: "ambiguous" });
  });

  test("a signed-out visitor with an order id is refused", async () => {
    const h = deps({ email: null });
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps), { ok: false, reason: "not_authorized" });
  });

  test("no Order (an unpaid or abandoned attempt has none) means no access, whatever the reference", async () => {
    const h = deps({ orders: [] });
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", ref: REF }, h.deps), { ok: false, reason: "not_authorized" });
    // A malformed reference is refused without a query.
    const h2 = deps();
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", ref: "not-a-ref" }, h2.deps), { ok: false, reason: "not_authorized" });
    assert.deepEqual(h2.calls, []);
  });

  test("a forged receipt token is refused", async () => {
    const h = deps();
    const r = await a.authorizeHostedAccess({ productId: "prod_hosted", token: "order_1.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, h.deps);
    assert.deepEqual(r, { ok: false, reason: "not_authorized" });
    assert.deepEqual(h.calls, [], "no Order lookup on a bad signature");
  });

  test("the decision never consults PaymentSession: its deps have no such lookup", () => {
    const src = read("lib/hosted-access/authorize.ts") + read("lib/hosted-access/server.ts");
    assert.ok(!/paymentSession/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
  });
});

describe("only the owner of a verified paid Order, or an admin", () => {
  test("the signed-in buyer opens their own purchase", async () => {
    const h = deps({ email: BUYER });
    const r = await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps);
    assert.ok(r.ok);
    assert.equal(r.ok && r.channel, "account");
    assert.equal(r.ok && r.accessUrl, "https://agent.example.com/start");
  });

  test("another signed-in buyer is refused for someone else's order", async () => {
    const h = deps({ email: "someone-else@example.test" });
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps), { ok: false, reason: "not_authorized" });
  });

  test("a buyer cannot use their order for product A to open product B", async () => {
    const h = deps({
      email: BUYER,
      orders: [order({ id: "order_a", productId: "prod_a" })],
      products: [hostedProduct({ id: "prod_a" }), hostedProduct({ id: "prod_b" })],
    });
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_b", purchase: "order_a" }, h.deps), { ok: false, reason: "not_authorized" });
    const ok = await a.authorizeHostedAccess({ productId: "prod_a", purchase: "order_a" }, h.deps);
    assert.ok(ok.ok);
  });

  test("an admin may open any order's delivery, and is recorded as admin", async () => {
    const h = deps({ email: "founder@example.test", admins: ["founder@example.test"] });
    const r = await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps);
    assert.equal(r.ok && r.channel, "admin");
  });

  test("the success-page reference works for its own Geidea order within 7 days, and expires after", async () => {
    assert.equal((await a.authorizeHostedAccess({ productId: "prod_hosted", ref: REF }, deps().deps)).ok, true);
    const old = deps({ orders: [order({ createdAt: new Date("2026-10-20T00:00:00Z") })] });
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", ref: REF }, old.deps), { ok: false, reason: "expired" });
    const stripe = deps({ orders: [order({ paymentProvider: "STRIPE" })] });
    assert.equal((await a.authorizeHostedAccess({ productId: "prod_hosted", ref: REF }, stripe.deps)).ok, false);
  });

  test("the receipt token works for its own order and product only", async () => {
    const token = links.signReceiptToken({ orderId: "order_1", productId: "prod_hosted", expiresAt: new Date("2026-11-10T00:00:00Z") }, SECRET);
    assert.equal((await a.authorizeHostedAccess({ productId: "prod_hosted", token }, deps().deps)).ok, true);
    // The same token presented for another product fails its signature.
    const other = deps({ products: [hostedProduct({ id: "prod_other" })] });
    assert.equal((await a.authorizeHostedAccess({ productId: "prod_other", token }, other.deps)).ok, false);
    const expired = links.signReceiptToken({ orderId: "order_1", productId: "prod_hosted", expiresAt: new Date("2026-11-01T00:00:00Z") }, SECRET);
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", token: expired }, deps().deps), { ok: false, reason: "expired" });
  });

  test("the Order is re-read on every request: a deleted order stops access at once", async () => {
    const orders = [order()];
    const h = deps({ email: BUYER, orders });
    assert.equal((await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps)).ok, true);
    orders.length = 0;
    assert.equal((await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps)).ok, false);
  });
});

describe("pending, rejected, suspended and file products deliver nothing here", () => {
  for (const [label, over] of [
    ["pending", { moderationStatus: "PENDING" }],
    ["rejected", { moderationStatus: "REJECTED" }],
    ["suspended shop", { shop: { isActive: false, name: "S" } }],
    ["no access record", { hostedAccess: null }],
    ["a FILE product", { deliveryType: "FILE" }],
    ["a stored link that fails today's rules", { hostedAccess: { accessUrl: "http://10.0.0.1/", instructions: null } }],
    ["stored instructions that fail today's rules", { hostedAccess: { accessUrl: "https://agent.example.com", instructions: "Password: x" } }],
  ] as const) {
    test(label, async () => {
      const h = deps({ email: BUYER, products: [hostedProduct(over as Partial<ProductRow>)] });
      assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps), { ok: false, reason: "unavailable" });
    });
  }
});

describe("Preview never honours production orders, production never honours test orders", () => {
  test("the environment rule, as a table", () => {
    assert.equal(a.environmentHonoured("PRODUCTION", "production"), true);
    assert.equal(a.environmentHonoured("PRODUCTION", "preview"), false);
    assert.equal(a.environmentHonoured("PRODUCTION", "development"), false);
    assert.equal(a.environmentHonoured("PRODUCTION", undefined), false);
    assert.equal(a.environmentHonoured("TEST", "production"), false);
    assert.equal(a.environmentHonoured("TEST", "preview"), true);
  });

  test("a real paid order opened on a Preview deployment is refused, even for its buyer and an admin", async () => {
    for (const email of [BUYER, "founder@example.test"]) {
      const h = deps({ email, admins: ["founder@example.test"], vercelEnv: "preview" });
      assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps), { ok: false, reason: "wrong_environment" });
    }
  });

  test("a test-gateway order on production delivers nothing", async () => {
    const h = deps({ email: BUYER, orders: [order({ paymentEnvironment: "TEST" })] });
    assert.deepEqual(await a.authorizeHostedAccess({ productId: "prod_hosted", purchase: "order_1" }, h.deps), { ok: false, reason: "wrong_environment" });
  });

  test("checkout itself still refuses a production Geidea account outside production", () => {
    const checkout = read("app/api/checkout/route.ts");
    assert.ok(checkout.includes('(configuredMode === "production" && !productionAccountHere(process.env.VERCEL_ENV))'));
  });
});

/* ------------------------------------------------------------------ */
/* Sellable, checkout and approval gates                               */
/* ------------------------------------------------------------------ */

describe("the storefront rule per delivery type", () => {
  const base = { isActive: true, moderationStatus: "APPROVED" as const, shop: { isActive: true }, fileKey: null, fileScanStatus: "PENDING_SCAN" as const, fileScanKey: null };

  test("a hosted product is sellable only approved, active, shop active, with its access record", () => {
    const hosted = { ...base, deliveryType: "HOSTED_ACCESS" as const, hostedAccess: { productId: "p" } };
    assert.equal(sellable.isSellable(hosted), true);
    assert.equal(sellable.unsellableReason(hosted), "sellable");
    assert.equal(sellable.unsellableReason({ ...hosted, hostedAccess: null }), "hosted_access_missing");
    assert.equal(sellable.unsellableReason({ ...hosted, moderationStatus: "PENDING" }), "not_approved");
    assert.equal(sellable.unsellableReason({ ...hosted, moderationStatus: "REJECTED" }), "not_approved");
    assert.equal(sellable.unsellableReason({ ...hosted, isActive: false }), "inactive");
    assert.equal(sellable.unsellableReason({ ...hosted, shop: { isActive: false } }), "shop_inactive");
  });

  test("a row loaded without deliveryType is a FILE row: a fileless hosted row fails closed", () => {
    const loadedCarelessly = { ...base, hostedAccess: { productId: "p" } };
    assert.equal(sellable.isSellable(loadedCarelessly), false);
    assert.equal(sellable.unsellableReason(loadedCarelessly), "missing_file_key");
  });

  test("a FILE product is decided by the file alone, as before, even if an access record somehow existed", () => {
    const file = { ...base, deliveryType: "FILE" as const, hostedAccess: { productId: "p" } };
    assert.equal(sellable.isSellable(file), false);
    assert.equal(sellable.isSellable({ ...file, fileKey: "k", fileScanStatus: "SAFE", fileScanKey: "k" }), true);
  });

  test("the approved-but-not-sellable list is file products only", () => {
    assert.equal((sellable.APPROVED_NOT_SELLABLE_WHERE as { deliveryType: string }).deliveryType, "FILE");
  });
});

describe("checkout and approval (structural)", () => {
  const checkout = read("app/api/checkout/route.ts");
  const moderation = read("app/api/admin/moderation/[productId]/route.ts");

  test("checkout: approval/shop gate, then the hosted gate or the file gates, all before any payment attempt", () => {
    const availability = checkout.indexOf('availability === "inactive" || availability === "not_approved" || availability === "shop_inactive"');
    const hosted = checkout.indexOf("if (hosted && !hostedAccessReady(product.hostedAccess)) {");
    const fileBlock = checkout.indexOf("if (!hosted) {");
    const safe = checkout.indexOf("if (!isDeliverableSafe(product)) {");
    const attempt = checkout.indexOf("geideaMode()");
    assert.ok(availability > 0 && hosted > availability && fileBlock > hosted && safe > fileBlock && attempt > safe);
    // The file gates still exist, unchanged in wording.
    assert.ok(checkout.includes("if (!product.fileUrl) {"));
    assert.ok(checkout.includes('error: "file_not_ready"'));
  });

  test("checkout never returns or logs the access record", () => {
    const uses = checkout.match(/product\.hostedAccess/g) ?? [];
    assert.equal(uses.length, 1, "read once, by the gate");
    assert.ok(!/log\([^)]*hostedAccess/.test(checkout));
  });

  test("approval of a hosted product needs its access record, checked again inside the write", () => {
    assert.ok(moderation.includes('if (action === "APPROVED" && hosted && !hostedAccessReady(product.hostedAccess)) {'));
    assert.ok(moderation.includes('if (action === "APPROVED" && !hosted && !isDeliverableSafe(product)) {'));
    assert.ok(moderation.includes("? { id: productId, moderationStatus: product.moderationStatus, ...HOSTED_ACCESS_READY_WHERE }"));
    assert.ok(moderation.includes("moderationStatus: product.moderationStatus,"));
    assert.ok(moderation.includes("...SAFE_DELIVERABLE_WHERE,"));
    assert.ok(moderation.includes("...noUnsafeExtrasWhere(),"));
  });

  test("the download route is untouched: a hosted product has no file, so it is refused there", () => {
    const download = read("app/api/download/[productId]/route.ts");
    assert.ok(download.includes("if (!isDeliverableSafe(product)) {"));
    assert.ok(!download.includes("hosted"));
  });
});

/* ------------------------------------------------------------------ */
/* Nothing public can carry the private details                       */
/* ------------------------------------------------------------------ */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the access details never reach a public surface", () => {
  // The only places allowed to read HostedAccess. Each is members-only,
  // admin-only, or the buyer's verified delivery.
  const ALLOWED = new Set([
    "app/api/checkout/route.ts", // gate only, never returned
    "app/api/admin/moderation/[productId]/route.ts", // admin, gate only
    "app/api/products/[id]/route.ts", // shop members only
    "lib/products/hosted-product.ts", // seller create/edit
    "lib/hosted-access/server.ts", // the verified delivery
    "lib/hosted-access/admin.ts", // admin review
    "lib/admin-product-preview.ts", // presence only (productId)
    "lib/admin-stats.ts", // presence only (productId)
  ]);

  test("no other file under app/ or lib/ selects or includes hostedAccess, or reads accessUrl from the database", () => {
    const files = [...walk(resolve(ROOT, "app")), ...walk(resolve(ROOT, "lib"))];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      const src = read(rel);
      assert.ok(!/hostedAccess:\s*\{\s*(select|include)/.test(src), `${rel} selects hostedAccess`);
      assert.ok(!/prisma\.hostedAccess\b/.test(src), `${rel} queries HostedAccess`);
    }
  });

  test("the presence-only readers select just the id", () => {
    for (const rel of ["lib/admin-product-preview.ts", "lib/admin-stats.ts"]) {
      const src = read(rel);
      assert.ok(src.includes("hostedAccess: { select: { productId: true } }"), rel);
      assert.ok(!src.includes("accessUrl"), rel);
    }
  });

  test("public pages read the delivery type only, never the details", () => {
    for (const rel of ["app/shop/[slug]/product/[productSlug]/page.tsx", "app/shop/[slug]/page.tsx", "app/browse/page.tsx", "app/page.tsx", "app/sitemap.ts", "app/checkout/[slug]/[productSlug]/page.tsx"]) {
      const src = read(rel);
      assert.ok(!src.includes("accessUrl") && !src.includes("instructions"), rel);
    }
  });

  test("the payment-status answer carries a delivery-page path, never the link", () => {
    const src = read("app/api/payment-status/route.ts");
    assert.ok(src.includes("{ accessPath: hostedAccessPath(attempt.order.productId, { ref }) }"));
    assert.ok(!src.includes("hostedAccess:"));
  });

  test("the product GET returns details only after membership is proven", () => {
    const src = read("app/api/products/[id]/route.ts");
    const select = src.indexOf("hostedAccess: { select: { accessUrl: true, instructions: true } },");
    const member = src.indexOf("if (!isMember) {");
    const reply = src.indexOf("...withoutReviewChecks(product), shop,");
    assert.ok(select > 0 && member > select && reply > member);
  });

  test("the delivery page never redirects, fetches or proxies the link", () => {
    const page = read("app/access/[productId]/page.tsx");
    assert.ok(!/redirect\(|fetch\(|NextResponse/.test(page));
    assert.ok(page.includes('rel="noopener noreferrer nofollow"'));
    assert.ok(page.includes('referrerPolicy="no-referrer"'));
    assert.ok(page.includes('export const dynamic = "force-dynamic";'));
    assert.ok(page.includes("robots: { index: false, follow: false, nocache: true }"));
    for (const rel of ["lib/hosted-access/authorize.ts", "lib/hosted-access/server.ts", "lib/hosted-access/validate.ts", "lib/hosted-access/admin.ts"]) {
      assert.ok(!/\bfetch\(/.test(read(rel)), `${rel} fetches`);
    }
  });

  test("the receipt email links to the delivery page, never to the seller's link", () => {
    const hook = read("app/api/webhooks/geidea/route.ts");
    assert.ok(hook.includes("downloadUrl: receiptAccessUrl(base, { orderId, productId: session.productId }, env.NEXTAUTH_SECRET),"));
    assert.ok(!hook.includes("accessUrl:"));
    const url = links.receiptAccessUrl("https://saiflow.test", { orderId: "order_1", productId: "prod_hosted", issuedAt: NOW }, SECRET);
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/access/prod_hosted");
    assert.deepEqual([...parsed.searchParams.keys()], ["t"]);
    assert.deepEqual(links.verifyReceiptToken(parsed.searchParams.get("t")!, "prod_hosted", SECRET, NOW), { ok: true, orderId: "order_1" });
  });
});

describe("the migration and schema", () => {
  test("additive: an enum, a defaulted column, a new table; nothing rewritten or dropped", () => {
    const sql = read("prisma/migrations/20261105120000_hosted_access_products/migration.sql").replace(/--[^\n]*/g, "");
    assert.ok(!/^\s*(UPDATE|DELETE|TRUNCATE|INSERT)\b/im.test(sql), "no row is written");
    assert.ok(!/\b(DROP|RENAME|TRUNCATE)\b/i.test(sql), "nothing is dropped or renamed");
    assert.ok(sql.includes(`ADD COLUMN IF NOT EXISTS "deliveryType" "ProductDeliveryType" NOT NULL DEFAULT 'FILE'`));
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS "HostedAccess"`));
  });

  test("the private details are their own table, not product columns", () => {
    const schema = read("prisma/schema.prisma");
    const product = /^model Product \{([\s\S]*?)^\}/m.exec(schema)![1];
    assert.ok(!/accessUrl|instructions/.test(product));
    assert.match(schema, /model HostedAccess \{[\s\S]*accessUrl\s+String/);
  });
});
