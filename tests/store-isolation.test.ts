/**
 * Store isolation: one seller can never read or change another seller's store.
 *
 * What must hold:
 *
 * 1. Every API route has a recorded authorization decision. Each exported
 *    method of every `app/api/**\/route.ts` appears in ROUTE_POLICY below with
 *    one of: admin, shop-member, shop-owner, self, public (with a reason),
 *    webhook, internal. A new route, or a new method on an old one, fails this
 *    file until someone decides who may call it. The policy is then checked
 *    against the source: an "admin" method must reach isAdminEmail and answer
 *    403, a "shop-member" method must take a session and check membership of
 *    the shop it acts on, and so on. That part is structural (it reads source);
 *    it proves the check is present, not that it is correct.
 *
 * 2. The checks are correct, proved by running the real handlers. Against one
 *    shared in-memory database holding two sellers, A (user_a, shop_a,
 *    product_a) and B (user_b, shop_b, product_b), seller A is signed in and
 *    aimed at B's resources. Every such call is refused, and the database is
 *    byte-for-byte what it was before the call: no write of any kind, to B's
 *    rows or anyone else's. Each refusal has a positive control (A on A's own
 *    resource gets through), so a 403 means "not yours", not "broken".
 *
 *    Refusal codes are recorded per route, because two routes deliberately
 *    answer 404 rather than 403 so a stranger cannot learn what exists:
 *      GET /api/products/[id]/inspect   404 (membership is part of the lookup)
 *      UploadThing middleware           throws the same error for every case
 *    Everything else answers 403 to a signed-in non-member. Signed out is 401,
 *    except the admin routes, which answer 403 to everyone who is not an admin.
 *
 * 3. The founder dashboard layout redirects anyone who is not an admin.
 *
 * No database, no network, no storage: Prisma, the session, storage, the scan
 * scheduler, notifications, the AI provider and UploadThing's builder are
 * mocked. The handlers, the authorization code and the libraries they use for
 * decisions (pricing, file safety, payouts, inspection policy) are real.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = resolve(ROOT, "app/api");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const local = (p: string) => pathToFileURL(resolve(ROOT, p)).href;

/* ================================================================== */
/* PART 1. Route x role inventory (structural)                        */
/* ================================================================== */

type Policy = "admin" | "shop-member" | "shop-owner" | "self" | "public" | "webhook" | "internal";

interface RouteDecision {
  policy: Policy;
  /** Required for "public": why no account check applies. */
  reason?: string;
  /** The handler lives in another file (UploadThing's router). */
  delegate?: string;
  /** Extra source facts the decision depends on. */
  mustContain?: string[];
  mustNotContain?: string[];
}

/**
 * Every route + method, and who may call it. Keyed "METHOD /api/path", with
 * the dynamic segments spelled as the folders are.
 */
const ROUTE_POLICY: Record<string, RouteDecision> = {
  // Marketplace admins (ADMIN_EMAILS) only.
  "GET /api/admin/inspect/[productId]": { policy: "admin" },
  "GET /api/admin/moderation": { policy: "admin" },
  "POST /api/admin/moderation/[productId]": { policy: "admin" },
  "GET /api/admin/payouts": { policy: "admin" },
  "POST /api/admin/payouts": { policy: "admin" },

  // A member of the shop the request acts on.
  "POST /api/ai/listing": { policy: "shop-member" },
  "POST /api/products": { policy: "shop-member" },
  "GET /api/products/[id]": { policy: "shop-member" },
  "PUT /api/products/[id]": { policy: "shop-member" },
  "DELETE /api/products/[id]": { policy: "shop-member" },
  "GET /api/products/[id]/inspect": { policy: "shop-member" },
  // A member, or an admin (both checked before anything else happens).
  "POST /api/products/[id]/rescan": { policy: "shop-member", mustContain: ["isAdminEmail("] },
  "GET /api/shops/[slug]": { policy: "shop-member" },
  "PUT /api/shops/[slug]": { policy: "shop-member" },
  "GET /api/uploadthing": { policy: "shop-member", delegate: "app/api/uploadthing/core.ts" },
  "POST /api/uploadthing": { policy: "shop-member", delegate: "app/api/uploadthing/core.ts" },

  // The OWNER of the shop: bank details decide where money goes.
  "GET /api/shops/[slug]/payout-account": { policy: "shop-owner" },
  "PUT /api/shops/[slug]/payout-account": { policy: "shop-owner" },

  // The signed-in account's own data, no shop named by the caller.
  "GET /api/orders": { policy: "self" },
  "GET /api/shops": { policy: "self", mustContain: ["sessionUserId("] },
  "POST /api/shops": { policy: "self", mustContain: ["userId: user.id", 'role: "OWNER"'] },

  // No account check, on purpose.
  "GET /api/auth/[...nextauth]": { policy: "public", reason: "NextAuth sign-in flow" },
  "POST /api/auth/[...nextauth]": { policy: "public", reason: "NextAuth sign-in flow" },
  "POST /api/auth/forgot-password": { policy: "public", reason: "auth flow: request a reset email", mustContain: ["rateLimiters.passwordReset("] },
  "POST /api/auth/reset-password": { policy: "public", reason: "auth flow: bearer reset token", mustContain: ["resetToken", "resetTokenExpiry"] },
  "POST /api/auth/verify-email": { policy: "public", reason: "auth flow: emailed token plus password", mustContain: ["verifyEmailWithToken("] },
  "POST /api/auth/verify-email/resend": { policy: "public", reason: "auth flow: same answer for every address", mustContain: ["GENERIC"] },
  "POST /api/signup": { policy: "public", reason: "account creation", mustContain: ["rateLimiters.signup("] },
  "POST /api/checkout": {
    policy: "public",
    reason: "guest checkout, behind PRE_LAUNCH_MODE; while it is on, only a founder test (server-side session on FOUNDER_TEST_EMAILS)",
    mustContain: ["env.PRE_LAUNCH_MODE", "currentCheckoutAccess()"],
  },
  "GET /api/download/[productId]": {
    policy: "public",
    reason: "buyer download: bearer reference, signed receipt token, or signed-in buyer's own order",
    mustContain: ["verifyReceiptToken(", "merchantReferenceId", "customerEmail", "credentials > 1"],
  },
  "GET /api/health": { policy: "public", reason: "health check, no data" },
  "GET /api/payment-status": { policy: "public", reason: "success page, unguessable bearer reference", mustContain: ["isMerchantReference("] },
  "POST /api/products/[id]/report": {
    policy: "public",
    reason: "abuse report: writes an audit row, never changes the product",
    mustContain: ["rateLimiters.report("],
    mustNotContain: ["prisma.product.update", "prisma.product.delete", "prisma.shop.update"],
  },

  // Provider callbacks, authenticated by signature.
  "POST /api/webhooks/geidea": { policy: "webhook", mustContain: ["verifyCallbackSignature("] },
  "POST /api/webhooks/stripe": { policy: "public", reason: "retired: answers 410 Gone and creates nothing", mustContain: ["status: 410"] },

  // Cron/operator worker, authenticated by a secret header.
  "GET /api/internal/scan": { policy: "internal" },
  "POST /api/internal/scan": { policy: "internal" },
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function findRouteFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...findRouteFiles(full));
    else if (entry.name === "route.ts" || entry.name === "route.tsx" || entry.name === "route.js") found.push(full);
  }
  return found.sort();
}

const routePath = (file: string) => {
  const rel = relative(API_ROOT, dirname(file)).split(sep).join("/");
  return rel ? `/api/${rel}` : "/api";
};

/**
 * Every exported HTTP method, in every export form Next accepts. A route file
 * that exports a method some other way would read as exporting nothing, which
 * the inventory refuses below rather than letting it pass unclassified.
 */
function exportedMethods(source: string): string[] {
  const src = strip(source);
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Z]+)\b/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Z]+)\s*[=:]/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(":").pop()!.trim();
      if (name) names.add(name);
    }
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/\s+as\s+/).pop()!.trim();
      if (name) names.add(name);
    }
  }
  return [...names].filter((n) => HTTP_METHODS.includes(n)).sort();
}

/** The text of one exported method, up to the next top-level declaration. */
function methodBody(source: string, method: string): string | null {
  const src = strip(source);
  const start = src.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`));
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export|async function|function|class|const|let|type|interface)\b/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

/**
 * The method's body plus every local helper it calls (to three levels), so a
 * check made in `requireOwner` or `requireAdmin` counts for its callers.
 */
function methodScope(source: string, method: string): string {
  const src = strip(source);
  const helpers = new Map<string, string>();
  for (const m of src.matchAll(/(?:^|\n)(?:async\s+)?function\s+(\w+)\s*\(/g)) {
    const at = (m.index ?? 0) + (m[0].startsWith("\n") ? 1 : 0);
    const rest = src.slice(at + 1);
    const next = rest.search(/\n(?:export|async function|function|class|const|let|type|interface)\b/);
    helpers.set(m[1], next < 0 ? src.slice(at) : src.slice(at, at + 1 + next));
  }
  let scope = methodBody(source, method) ?? "";
  const seen = new Set<string>();
  for (let depth = 0; depth < 3; depth++) {
    for (const [name, text] of helpers) {
      if (!seen.has(name) && new RegExp(`\\b${name}\\(`).test(scope)) {
        seen.add(name);
        scope += "\n" + text;
      }
    }
  }
  return scope;
}

const SESSION = /getServerSession\(/;
const MEMBERSHIP = [
  /prisma\.shopUser\.findFirst\(\{[\s\S]{0,240}?shopId/,
  /shopUsers\.some\(/,
  /shopUsers\.find\(/,
  /shopUsers:\s*\{\s*some:/,
  /shopUsers\.length\s*===\s*0/,
];
// `{ status: 403 }`, or the AI route's `fail("FORBIDDEN", 403)` helper.
const REFUSAL = /status:\s*(?:403|404)|fail\("FORBIDDEN",\s*403\)/;

/** What is wrong with this method's source, given its declared policy. */
function policyProblems(key: string, decision: RouteDecision, source: string): string[] {
  const method = key.split(" ")[0];
  const problems: string[] = [];
  const scope = methodScope(source, method);
  const src = strip(source);

  switch (decision.policy) {
    case "admin":
      if (!/isAdminEmail\(/.test(scope)) problems.push("never reaches isAdminEmail()");
      if (!/status:\s*403/.test(scope)) problems.push("never answers 403");
      break;
    case "shop-member":
    case "shop-owner": {
      if (decision.delegate) {
        const core = strip(read(decision.delegate));
        const routes = [...core.matchAll(/:\s*f\(/g)].length;
        const guarded = [...core.matchAll(/\.middleware\(requireShopMember\)/g)].length;
        if (routes === 0) problems.push("delegate defines no upload routes");
        if (routes !== guarded) problems.push(`${routes} upload routes but ${guarded} use requireShopMember`);
        const guard = core.slice(core.indexOf("const requireShopMember"));
        if (!SESSION.test(guard)) problems.push("requireShopMember takes no session");
        if (!/prisma\.shopUser\.findFirst\([\s\S]{0,200}?shopId:\s*input\.shopId/.test(guard)) {
          problems.push("requireShopMember does not look up membership of the named shop");
        }
        break;
      }
      if (!SESSION.test(scope)) problems.push("takes no session");
      if (!MEMBERSHIP.some((re) => re.test(scope))) problems.push("no shop-membership check");
      if (!REFUSAL.test(scope)) problems.push("never answers 403/404");
      if (decision.policy === "shop-owner" && !/role\s*===\s*"OWNER"/.test(scope)) {
        problems.push('does not require role === "OWNER"');
      }
      break;
    }
    case "self":
      if (!SESSION.test(scope)) problems.push("takes no session");
      if (!/session\.user\.email|sessionUserId\(session\)/.test(scope)) problems.push("does not scope to the signed-in account");
      if (!/status:\s*401/.test(scope)) problems.push("never answers 401");
      break;
    case "public":
      if (!decision.reason || decision.reason.trim().length < 8) problems.push("public without a reason");
      break;
    case "webhook":
      if (!decision.mustContain?.length) problems.push("webhook without a named signature check");
      break;
    case "internal":
      if (!/CRON_SECRET/.test(scope)) problems.push("never reads CRON_SECRET");
      if (!/timingSafeEqual\(/.test(scope)) problems.push("does not compare the secret in constant time");
      if (!/status:\s*403/.test(scope)) problems.push("never answers 403");
      break;
  }
  for (const needle of decision.mustContain ?? []) {
    if (!src.includes(needle)) problems.push(`source lacks ${JSON.stringify(needle)}`);
  }
  for (const needle of decision.mustNotContain ?? []) {
    if (src.includes(needle)) problems.push(`source contains ${JSON.stringify(needle)}`);
  }
  return problems;
}

const ROUTE_FILES = findRouteFiles(API_ROOT);
const DISCOVERED = new Map<string, string>(); // "METHOD /api/path" -> file
for (const file of ROUTE_FILES) {
  for (const method of exportedMethods(readFileSync(file, "utf8"))) {
    DISCOVERED.set(`${method} ${routePath(file)}`, file);
  }
}

describe("route inventory: every API method has an authorization decision", () => {
  test("the scan finds the route tree", () => {
    assert.ok(ROUTE_FILES.length >= 25, `only ${ROUTE_FILES.length} route files found`);
  });

  test("every route file exports at least one recognised HTTP method", () => {
    const silent = ROUTE_FILES.filter((f) => exportedMethods(readFileSync(f, "utf8")).length === 0);
    assert.deepEqual(silent.map((f) => relative(ROOT, f)), [], "route files whose methods could not be read");
    const defaults = ROUTE_FILES.filter((f) => /export\s+default\b/.test(strip(readFileSync(f, "utf8"))));
    assert.deepEqual(defaults.map((f) => relative(ROOT, f)), [], "a route handler must be a named method export");
  });

  test("every exported method is in ROUTE_POLICY", () => {
    const missing = [...DISCOVERED.keys()].filter((k) => !(k in ROUTE_POLICY)).sort();
    assert.deepEqual(missing, [], `Unclassified routes. Add each to ROUTE_POLICY with a decision:\n  ${missing.join("\n  ")}`);
  });

  test("ROUTE_POLICY names no route or method that does not exist", () => {
    const stale = Object.keys(ROUTE_POLICY).filter((k) => !DISCOVERED.has(k)).sort();
    assert.deepEqual(stale, [], `Stale ROUTE_POLICY entries:\n  ${stale.join("\n  ")}`);
  });

  test("the checker is not vacuous: it flags handlers that skip the check", () => {
    const unguardedMember = `export async function GET(req: Request) {
      const product = await prisma.product.findUnique({ where: { id } });
      return NextResponse.json(product);
    }`;
    assert.ok(policyProblems("GET /x", { policy: "shop-member" }, unguardedMember).length >= 2);
    const sessionOnly = `export async function PUT(req: Request) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email) return NextResponse.json({}, { status: 401 });
      return NextResponse.json(await prisma.shop.update({ where: { slug }, data }));
    }`;
    assert.deepEqual(policyProblems("PUT /x", { policy: "shop-member" }, sessionOnly), [
      "no shop-membership check",
      "never answers 403/404",
    ]);
    const signedInIsNotAdmin = `export async function GET(req: Request) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      return NextResponse.json(await prisma.payout.findMany());
    }`;
    assert.deepEqual(policyProblems("GET /x", { policy: "admin" }, signedInIsNotAdmin), ["never reaches isAdminEmail()"]);
    // A check in a different method of the same file does not count.
    const otherMethod = `export async function GET() { return NextResponse.json(await prisma.order.findMany()); }
export async function POST() { if (!isAdminEmail(e)) return NextResponse.json({}, { status: 403 }); }`;
    assert.deepEqual(policyProblems("GET /x", { policy: "admin" }, otherMethod), [
      "never reaches isAdminEmail()",
      "never answers 403",
    ]);
    assert.deepEqual(policyProblems("GET /x", { policy: "public" }, "export async function GET() {}"), ["public without a reason"]);
  });

  for (const [key, decision] of Object.entries(ROUTE_POLICY)) {
    test(`${key} -> ${decision.policy}`, () => {
      const file = DISCOVERED.get(key);
      if (!file) return; // reported by the stale-entry test above
      const problems = policyProblems(key, decision, readFileSync(file, "utf8"));
      assert.deepEqual(problems, [], `${key} (${relative(ROOT, file)}): ${problems.join("; ")}`);
    });
  }
});

describe("founder dashboard layout", () => {
  test("app/dashboard/admin/layout.tsx redirects the signed-out and non-admins", () => {
    const path = "app/dashboard/admin/layout.tsx";
    assert.ok(existsSync(resolve(ROOT, path)));
    const src = strip(read(path));
    assert.match(src, /getServerSession\(authOptions\)/);
    assert.match(src, /if\s*\(\s*!session\?\.user\?\.email\s*\)\s*redirect\("\/login"\)/);
    assert.match(src, /if\s*\(\s*!isAdminEmail\(session\.user\.email\)\s*\)\s*redirect\("\/dashboard"\)/);
    // The check runs before children render, and nothing renders on the way.
    assert.ok(src.indexOf("isAdminEmail(") < src.indexOf("{children}"));
  });

  test("the guarding layout sits at the root of the admin segment", () => {
    const dir = resolve(ROOT, "app/dashboard/admin");
    const layouts: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = resolve(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/^layout\.(t|j)sx?$/.test(e.name)) layouts.push(relative(ROOT, full));
      }
    };
    walk(dir);
    // Nested layouts are fine (they still sit inside this one); this records
    // that the root admin layout exists where every admin page inherits it.
    assert.ok(layouts.includes("app/dashboard/admin/layout.tsx"));
  });
});

/* ================================================================== */
/* PART 2. Behavioural matrix (real handlers, fake database)           */
/* ================================================================== */

/* ---------------------------- fake Prisma ---------------------------- */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Table =
  | "user"
  | "shop"
  | "shopUser"
  | "product"
  | "fileAsset"
  | "order"
  | "sellerPayoutAccount"
  | "payout"
  | "moderationEvent"
  | "aiGeneration";

const TABLES: Table[] = [
  "user",
  "shop",
  "shopUser",
  "product",
  "fileAsset",
  "order",
  "sellerPayoutAccount",
  "payout",
  "moderationEvent",
  "aiGeneration",
];

let db: Record<Table, Row[]> = Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Record<Table, Row[]>;
const writes: Array<{ table: Table; op: string; rows: Row[] }> = [];

interface Relation {
  table: Table;
  many: boolean;
  on: (parent: Row, child: Row) => boolean;
}
const RELATIONS: Partial<Record<Table, Record<string, Relation>>> = {
  user: { shopUsers: { table: "shopUser", many: true, on: (u, su) => su.userId === u.id } },
  shop: {
    shopUsers: { table: "shopUser", many: true, on: (s, su) => su.shopId === s.id },
    products: { table: "product", many: true, on: (s, p) => p.shopId === s.id },
    payoutAccount: { table: "sellerPayoutAccount", many: false, on: (s, a) => a.shopId === s.id },
  },
  shopUser: {
    user: { table: "user", many: false, on: (su, u) => u.id === su.userId },
    shop: { table: "shop", many: false, on: (su, s) => s.id === su.shopId },
  },
  product: {
    shop: { table: "shop", many: false, on: (p, s) => s.id === p.shopId },
    orders: { table: "order", many: true, on: (p, o) => o.productId === p.id },
    moderationEvents: { table: "moderationEvent", many: true, on: (p, e) => e.productId === p.id },
  },
  order: { product: { table: "product", many: false, on: (o, p) => p.id === o.productId } },
  sellerPayoutAccount: { shop: { table: "shop", many: false, on: (a, s) => s.id === a.shopId } },
};

const related = (table: Table, row: Row, rel: Relation) => db[rel.table].filter((child) => rel.on(row, child));

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond === null) return actual === null || actual === undefined;
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
  if (typeof cond === "object" && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    const fold = (v: unknown) => (c.mode === "insensitive" && typeof v === "string" ? v.toLowerCase() : v);
    for (const [op, v] of Object.entries(c)) {
      if (op === "mode") continue;
      let ok: boolean;
      if (op === "equals") ok = fold(actual) === fold(v);
      else if (op === "in") ok = (v as unknown[]).map(fold).includes(fold(actual));
      else if (op === "not") ok = v === null ? actual !== null && actual !== undefined : fold(actual) !== fold(v);
      else if (op === "lt") ok = (actual as number) < (v as number);
      else if (op === "gt") ok = (actual as number) > (v as number);
      else throw new Error(`fake prisma: unsupported operator ${op}`);
      if (!ok) return false;
    }
    return true;
  }
  return actual === cond;
}

function matches(table: Table, row: Row, where: Row | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (cond === undefined) continue;
    let ok: boolean;
    if (key === "AND") ok = (cond as Row[]).every((w) => matches(table, row, w));
    else if (key === "OR") ok = (cond as Row[]).some((w) => matches(table, row, w));
    else {
      const rel = RELATIONS[table]?.[key];
      if (rel) {
        const rows = related(table, row, rel);
        if (rel.many) {
          if ("some" in cond) ok = rows.some((r) => matches(rel.table, r, cond.some));
          else if ("every" in cond) ok = rows.every((r) => matches(rel.table, r, cond.every));
          else if ("none" in cond) ok = !rows.some((r) => matches(rel.table, r, cond.none));
          else throw new Error(`fake prisma: list relation ${table}.${key} needs some/every/none`);
        } else {
          ok = rows.length > 0 && matches(rel.table, rows[0], cond);
        }
      } else {
        ok = matchValue(row[key], cond);
      }
    }
    if (!ok) return false;
  }
  return true;
}

function project(table: Table, row: Row, spec: { select?: Row; include?: Row } = {}): Row {
  const fields = spec.select ?? spec.include;
  const out: Row = spec.select ? {} : { ...row };
  if (!fields) return out;
  for (const [key, want] of Object.entries(fields)) {
    if (!want) continue;
    if (key === "_count") {
      out._count = {};
      for (const name of Object.keys(want.select)) {
        out._count[name] = related(table, row, RELATIONS[table]![name]).length;
      }
      continue;
    }
    const rel = RELATIONS[table]?.[key];
    if (rel) {
      const sub = want === true ? {} : want;
      let rows = related(table, row, rel);
      if (sub.where) rows = rows.filter((r) => matches(rel.table, r, sub.where));
      out[key] = rel.many ? rows.map((r) => project(rel.table, r, sub)) : rows[0] ? project(rel.table, rows[0], sub) : null;
    } else if (spec.select) {
      if (!(key in row)) throw new Error(`fake prisma: ${table}.${key} is not a column of the seed`);
      out[key] = row[key];
    }
  }
  return out;
}

let idCounter = 0;
function delegate(table: Table) {
  const find = (where?: Row) => db[table].filter((r) => matches(table, r, where));
  const record = (op: string, rows: Row[]) => writes.push({ table, op, rows: rows.map((r) => ({ ...r })) });
  return {
    findUnique: async ({ where, ...spec }: Row) => {
      const row = find(where)[0];
      return row ? project(table, row, spec) : null;
    },
    findFirst: async ({ where, ...spec }: Row = {}) => {
      const row = find(where)[0];
      return row ? project(table, row, spec) : null;
    },
    findMany: async ({ where, take, orderBy: _o, ...spec }: Row = {}) => {
      void _o;
      const rows = find(where);
      return (take ? rows.slice(0, take) : rows).map((r) => project(table, r, spec));
    },
    count: async ({ where }: Row = {}) => find(where).length,
    create: async ({ data, ...spec }: Row) => {
      for (const [k, v] of Object.entries(data)) {
        if (RELATIONS[table]?.[k] && v && typeof v === "object") throw new Error(`fake prisma: nested write ${table}.${k}`);
      }
      const now = new Date();
      const row = { id: `${table}_${++idCounter}`, createdAt: now, updatedAt: now, ...data };
      db[table].push(row);
      record("create", [row]);
      return project(table, row, spec);
    },
    update: async ({ where, data, ...spec }: Row) => {
      const row = find(where)[0];
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, data, { updatedAt: new Date() });
      record("update", [row]);
      return project(table, row, spec);
    },
    updateMany: async ({ where, data }: Row) => {
      const rows = find(where);
      for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
      if (rows.length) record("updateMany", rows);
      return { count: rows.length };
    },
    delete: async ({ where }: Row) => {
      const row = find(where)[0];
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      db[table] = db[table].filter((r) => r !== row);
      record("delete", [row]);
      return row;
    },
    upsert: async ({ where, create, update, ...spec }: Row) => {
      const row = find(where)[0];
      if (row) {
        Object.assign(row, update, { updatedAt: new Date() });
        record("upsert:update", [row]);
        return project(table, row, spec);
      }
      const now = new Date();
      const created = { id: `${table}_${++idCounter}`, createdAt: now, updatedAt: now, ...create };
      db[table].push(created);
      record("upsert:create", [created]);
      return project(table, created, spec);
    },
  };
}

const prisma: Row = {
  ...Object.fromEntries(TABLES.map((t) => [t, delegate(t)])),
  $transaction: async (arg: unknown) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg as Promise<unknown>[])),
  $queryRaw: async () => [{ "?column?": 1 }],
};
// lib/file-safety builds SAFE_DELIVERABLE_WHERE from a field reference at load.
prisma.product.fields = { fileKey: { _toFieldRef: "Product.fileKey" } };

/* ------------------------------ seed -------------------------------- */

const ADMIN = { id: "user_admin", email: "founder@admin.test" };
const SELLER_A = { id: "user_a", email: "a@seller.test" };
const SELLER_B = { id: "user_b", email: "b@seller.test" };
const IBAN_A = "SA0380000000608010167519";
const IBAN_B = "SA4420000001234567891234";
const T0 = new Date("2026-10-01T10:00:00Z");

function product(id: string, shopId: string, key: string, moderationStatus: string): Row {
  return {
    id,
    shopId,
    name: `Planner ${id}`,
    slug: `planner-${id}`,
    description: "A weekly planner",
    price: "25.00",
    currency: "SAR",
    category: "templates",
    fileUrl: `https://app1.ufs.sh/f/${key}`,
    fileKey: key,
    fileScanStatus: "SAFE",
    fileScanKey: key,
    fileScanSha256: "ab".repeat(32),
    fileScanAt: T0,
    fileScanAttempts: 1,
    thumbnailUrl: null,
    moderationStatus,
    certifiedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  };
}

function asset(key: string, shopId: string, userId: string): Row {
  return {
    id: `fa_${key}`,
    key,
    shopId,
    route: "PRODUCT_FILE",
    uploadedById: userId,
    name: `${key}.pdf`,
    size: 1024,
    declaredType: "application/pdf",
    scanStatus: "SAFE",
    scanAttempts: 1,
    scanAt: T0,
    scanReason: null,
    scanSha256: "ab".repeat(32),
    scanClaimToken: null,
    scanClaimedAt: null,
    createdAt: T0,
  };
}

function order(id: string, productId: string, buyer: string): Row {
  return {
    id,
    productId,
    productName: `Planner ${productId}`,
    price: "25.00",
    customerEmail: buyer,
    createdAt: T0,
    paymentEnvironment: "PRODUCTION",
    // As the database stores every ordinary order (DEFAULT false).
    founderTest: false,
    paymentProvider: "GEIDEA",
    grossAmount: "25.00",
    platformFeeAmount: "2.50",
    sellerNetAmount: "22.50",
    payoutId: null,
    merchantReferenceId: `ref_${id}`,
    stripeSessionId: null,
  };
}

function seed() {
  idCounter = 0;
  db = {
    user: [
      { ...SELLER_A, name: "Seller A", createdAt: T0 },
      { ...SELLER_B, name: "Seller B", createdAt: T0 },
      { ...ADMIN, name: "Founder", createdAt: T0 },
    ],
    shop: [
      { id: "shop_a", slug: "shop-a", name: "Shop A", description: "A", logo: null, coverImage: null, isActive: true, createdAt: T0, updatedAt: T0 },
      { id: "shop_b", slug: "shop-b", name: "Shop B", description: "B", logo: null, coverImage: null, isActive: true, createdAt: T0, updatedAt: T0 },
    ],
    shopUser: [
      { id: "su_a", userId: "user_a", shopId: "shop_a", role: "OWNER" },
      { id: "su_b", userId: "user_b", shopId: "shop_b", role: "OWNER" },
    ],
    product: [product("product_a", "shop_a", "key_a", "APPROVED"), product("product_b", "shop_b", "key_b", "PENDING")],
    fileAsset: [
      asset("key_a", "shop_a", "user_a"),
      asset("key_b", "shop_b", "user_b"),
      // Uploaded by A, not yet attached: what a new product of A's would carry.
      asset("key_new_a", "shop_a", "user_a"),
    ],
    order: [order("order_a1", "product_a", "buyer-of-a@example.test"), order("order_b1", "product_b", "buyer-of-b@example.test")],
    sellerPayoutAccount: [
      { id: "acct_b", shopId: "shop_b", holderName: "Seller B", iban: IBAN_B, bankName: "Bank B", updatedById: "user_b", updatedAt: T0 },
    ],
    payout: [],
    moderationEvent: [],
    aiGeneration: [],
  };
  writes.length = 0;
}

const snapshot = () => JSON.stringify(db);

/* ------------------------- other collaborators ------------------------ */

const state = {
  session: null as null | { user: { id: string; email: string } },
  signed: [] as string[],
  scheduled: [] as string[],
  aiCalls: 0,
  scanBatches: 0,
};
const logs: string[] = [];

class FakeUploadThingError extends Error {}
type UploadRouteDef = { config: unknown; middleware: (opts: { input: { shopId: string } }) => Promise<unknown> };

/** Signed in as `who`, or signed out. Sessions carry { id, email }, as authOptions' callback builds them. */
function signIn(who: { id: string; email: string } | null) {
  state.session = who ? { user: { id: who.id, email: who.email } } : null;
}

let n = 0;
function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  n++;
  return new Request(`https://saiflow.test${path}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${n >> 8 & 255}.${n & 255}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** The output a valid model response must have to pass listingOutputSchema. */
const AI_OUTPUT = {
  improvedTitle: "Weekly Planner",
  shortSummary: "A tidy weekly planner for busy weeks.",
  fullDescription: "A printable weekly planner with goals, habits and notes for every day.",
  keyBenefits: ["Plan the week", "Track habits", "Keep notes"],
  targetAudience: "Busy students",
  faq: [
    { question: "Is it printable?", answer: "Yes, on A4." },
    { question: "Is it editable?", answer: "Yes, as a PDF." },
  ],
  cta: "Get the planner",
  seoTitle: "Weekly planner PDF",
  seoDescription: "A printable weekly planner with goals, habits and notes.",
  suggestedCategory: "templates",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => Promise<Response>;
const H: Record<string, Handler> = {};
let uploadRoutes: Record<string, UploadRouteDef>;

before(async () => {
  process.env.ADMIN_EMAILS = ADMIN.email;
  process.env.AI_LISTING_ASSISTANT_ENABLED = "true";
  process.env.AI_LISTING_BETA_EMAILS = `${SELLER_A.email},${SELLER_B.email}`;
  process.env.CRON_SECRET = "test-cron-secret-not-real";
  process.env.UPLOADTHING_APP_ID = "app1";

  mock.module("next-auth", { namedExports: { getServerSession: async () => state.session } });
  mock.module(local("app/api/auth/authOptions.ts"), { namedExports: { authOptions: {} } });
  mock.module(local("lib/prisma.ts"), { namedExports: { prisma }, defaultExport: prisma });

  // Always allow: isolation, not throttling, is under test here.
  const allow = () => ({ success: true, remaining: 99, resetTime: Date.now() + 60_000 });
  mock.module(local("lib/rate-limit.ts"), {
    namedExports: {
      rateLimit: allow,
      rateLimiters: Object.fromEntries(
        ["auth", "signup", "passwordReset", "payoutAccount", "api", "report", "checkout", "createShop", "createProduct"].map((k) => [k, allow])
      ),
      getClientIp: () => "test-ip",
      accountKey: (email: string) => `acct:${email.toLowerCase()}`,
      retryAfterSeconds: () => 60,
    },
  });

  mock.module(local("lib/storage/provider.ts"), {
    namedExports: {
      createDeliveryUrl: async (key: string) => {
        state.signed.push(key);
        return { ok: true, url: `https://signed.example.test/${key}?sig=x` };
      },
      readPrivateObject: async () => ({ ok: false, reason: "not_configured" }),
      isStorageConfigured: () => false,
      MAX_SCANNABLE_BYTES: 128 * 1024 * 1024,
      DEFAULT_DELIVERY_TTL_SECONDS: 60,
      MIN_DELIVERY_TTL_SECONDS: 30,
      MAX_DELIVERY_TTL_SECONDS: 300,
    },
  });
  mock.module(local("lib/scan/run.ts"), {
    namedExports: {
      MAX_SCAN_ATTEMPTS: 3,
      SCAN_LEASE_MS: 10 * 60_000,
      scanFileAsset: async (key: string) => ({ key, outcome: "SKIPPED" }),
      findScannableKeys: async () => {
        state.scanBatches++;
        return [];
      },
    },
  });
  mock.module(local("lib/scan/schedule.ts"), {
    namedExports: {
      scheduleScan: (key: string) => {
        state.scheduled.push(key);
        return true;
      },
    },
  });
  mock.module(local("lib/scan/announce.ts"), {
    namedExports: { announceReadyAtAttach: async () => false, isReadyAtAttach: () => false },
  });
  mock.module(local("lib/scan/cloudmersive.ts"), {
    namedExports: { cloudmersiveProvider: { id: "fake", isConfigured: () => true, scan: async () => ({ ok: false }) } },
  });
  const noop = async () => ({ status: "skipped" });
  mock.module(local("lib/notify.ts"), {
    namedExports: {
      notifyAdminsStoreCreated: noop,
      notifyAdminsProductReadyForReview: noop,
      notifyProductModerated: noop,
      notifySaleFulfilled: noop,
      notifyPayoutAccountChanged: noop,
    },
  });
  mock.module(local("lib/after-response.ts"), {
    namedExports: { runAfterResponse: async () => "deferred", afterResponse: () => undefined },
  });
  mock.module("resend", {
    namedExports: { Resend: class { emails = { send: async () => ({ data: null, error: null }) }; } },
  });
  mock.module(local("lib/ai/provider.ts"), {
    namedExports: {
      generateJson: async () => {
        state.aiCalls++;
        return { json: JSON.stringify(AI_OUTPUT), provider: "mock", model: "mock-model", inputTokens: 1, outputTokens: 1 };
      },
      getModelName: () => "mock-model",
      getProviderName: () => "mock",
      isLiveProvider: () => false,
      ProviderTimeoutError: class extends Error {},
      ProviderCallError: class extends Error {},
    },
  });
  mock.module(local("lib/ai/usage.ts"), {
    namedExports: { canGenerate: async () => ({ allowed: true, usage: { fullRemaining: 10, sectionRemaining: 10 } }) },
  });

  // UploadThing's builder, reduced to what records the middleware: the
  // middleware is the authorization, and it is what runs here.
  mock.module("uploadthing/next", {
    namedExports: {
      createUploadthing: () => (config: unknown) => {
        const route: Row = { config };
        const builder = {
          input: (schema: unknown) => ((route.input = schema), builder),
          middleware: (fn: unknown) => ((route.middleware = fn), builder),
          onUploadComplete: (fn: unknown) => ((route.onUploadComplete = fn), route),
        };
        return builder;
      },
    },
  });
  mock.module("uploadthing/server", { namedExports: { UploadThingError: FakeUploadThingError } });

  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  }

  const products = await import("../app/api/products/route.ts");
  const product = await import("../app/api/products/[id]/route.ts");
  const shops = await import("../app/api/shops/route.ts");
  const shop = await import("../app/api/shops/[slug]/route.ts");
  const payout = await import("../app/api/shops/[slug]/payout-account/route.ts");
  H.productsPOST = products.POST;
  H.productGET = product.GET;
  H.productPUT = product.PUT;
  H.productDELETE = product.DELETE;
  H.inspectGET = (await import("../app/api/products/[id]/inspect/route.ts")).GET;
  H.rescanPOST = (await import("../app/api/products/[id]/rescan/route.ts")).POST;
  H.shopsGET = shops.GET;
  H.shopGET = shop.GET;
  H.shopPUT = shop.PUT;
  H.payoutGET = payout.GET;
  H.payoutPUT = payout.PUT;
  H.ordersGET = (await import("../app/api/orders/route.ts")).GET;
  H.aiPOST = (await import("../app/api/ai/listing/route.ts")).POST;
  H.adminModerationGET = (await import("../app/api/admin/moderation/route.ts")).GET;
  H.adminDecisionPOST = (await import("../app/api/admin/moderation/[productId]/route.ts")).POST;
  H.adminInspectGET = (await import("../app/api/admin/inspect/[productId]/route.ts")).GET;
  const adminPayouts = await import("../app/api/admin/payouts/route.ts");
  H.adminPayoutsGET = adminPayouts.GET;
  H.adminPayoutsPOST = adminPayouts.POST;
  const scan = await import("../app/api/internal/scan/route.ts");
  H.scanGET = scan.GET;
  H.scanPOST = scan.POST;
  uploadRoutes = (await import("../app/api/uploadthing/core.ts")).ourFileRouter as unknown as Record<string, UploadRouteDef>;
});

beforeEach(() => {
  seed();
  state.session = null;
  state.signed = [];
  state.scheduled = [];
  state.aiCalls = 0;
  state.scanBatches = 0;
  logs.length = 0;
});

/**
 * Run `call` as seller A against B and require a refusal with `status` that
 * left the database exactly as it was: no write to any row, B's included,
 * nothing signed, nothing scheduled for scanning.
 */
async function refusedWithoutSideEffects(status: number | number[], call: () => Promise<Response>) {
  const before = snapshot();
  const res = await call();
  const allowed = Array.isArray(status) ? status : [status];
  assert.ok(allowed.includes(res.status), `expected ${allowed.join("/")}, got ${res.status}: ${await res.clone().text()}`);
  assert.deepEqual(writes, [], "a refused request wrote to the database");
  assert.equal(snapshot(), before, "a refused request changed the database");
  assert.deepEqual(state.signed, [], "a refused request minted a delivery URL");
  assert.deepEqual(state.scheduled, [], "a refused request scheduled a scan");
  return res;
}

/** Every recorded write touched only seller A's rows. */
function wroteOnlyA() {
  const B_IDS = new Set(["user_b", "shop_b", "su_b", "product_b", "fa_key_b", "key_b", "order_b1", "acct_b"]);
  for (const w of writes) {
    for (const row of w.rows) {
      for (const field of ["id", "key", "shopId", "productId", "userId"]) {
        assert.ok(!B_IDS.has(row[field]), `${w.op} on ${w.table} touched B (${field}=${row[field]})`);
      }
    }
  }
}

/* ----------------------------- products ----------------------------- */

describe("products: seller A cannot reach product_b", () => {
  beforeEach(() => signIn(SELLER_A));

  test("GET /api/products/[id] -> 403; A's own -> 200 without the member list", async () => {
    await refusedWithoutSideEffects(403, () => H.productGET(req("GET", "/api/products/product_b"), ctx({ id: "product_b" })));
    const own = await H.productGET(req("GET", "/api/products/product_a"), ctx({ id: "product_a" }));
    assert.equal(own.status, 200);
    const body = await own.json();
    assert.equal(body.id, "product_a");
    assert.equal(body.shop.shopUsers, undefined);
  });

  test("PUT /api/products/[id] -> 403, product_b unchanged; A's own -> 200", async () => {
    await refusedWithoutSideEffects(403, () =>
      H.productPUT(req("PUT", "/api/products/product_b", { name: "Hijacked", price: "1.00" }), ctx({ id: "product_b" }))
    );
    assert.equal(db.product.find((p) => p.id === "product_b")!.name, "Planner product_b");

    const own = await H.productPUT(req("PUT", "/api/products/product_a", { name: "Renamed A" }), ctx({ id: "product_a" }));
    assert.equal(own.status, 200);
    assert.equal(db.product.find((p) => p.id === "product_a")!.name, "Renamed A");
    wroteOnlyA();
  });

  test("DELETE /api/products/[id] -> 403, product_b still there; A's own -> 200", async () => {
    await refusedWithoutSideEffects(403, () => H.productDELETE(req("DELETE", "/api/products/product_b"), ctx({ id: "product_b" })));
    assert.ok(db.product.some((p) => p.id === "product_b"));

    const own = await H.productDELETE(req("DELETE", "/api/products/product_a"), ctx({ id: "product_a" }));
    assert.equal(own.status, 200);
    assert.ok(!db.product.some((p) => p.id === "product_a"));
    wroteOnlyA();
  });

  test("POST /api/products into shop_b -> 403; into shop_a -> 201", async () => {
    // Every product needs its deliverable; this one is A's own fresh upload.
    const body = {
      name: "Planted product",
      price: "10.00",
      category: "templates",
      certified: true,
      fileUrl: "https://app1.ufs.sh/f/key_new_a",
    };
    await refusedWithoutSideEffects(403, () => H.productsPOST(req("POST", "/api/products", { ...body, shopId: "shop_b" })));
    assert.equal(db.product.filter((p) => p.shopId === "shop_b").length, 1);

    const own = await H.productsPOST(req("POST", "/api/products", { ...body, shopId: "shop_a" }));
    assert.equal(own.status, 201);
    assert.equal((await own.json()).shopId, "shop_a");
    wroteOnlyA();
  });

  test("POST /api/products into A's own shop: no file, or B's file -> 400 with nothing written; A's own upload -> 201", async () => {
    // 17 Oct 2026, part 3 item 10: a product needs its own store's deliverable.
    const base = { name: "My planner", price: "10.00", category: "templates", certified: true, shopId: "shop_a" };
    const noFile = await refusedWithoutSideEffects(400, () => H.productsPOST(req("POST", "/api/products", base)));
    assert.equal((await noFile.json()).code, "file_required");
    await refusedWithoutSideEffects(400, () =>
      H.productsPOST(req("POST", "/api/products", { ...base, fileUrl: "https://app1.ufs.sh/f/key_b" }))
    );
    const own = await H.productsPOST(req("POST", "/api/products", { ...base, fileUrl: "https://app1.ufs.sh/f/key_new_a" }));
    assert.equal(own.status, 201);
    wroteOnlyA();
  });

  test("GET /api/products/[id]/inspect -> 404 (hides existence), nothing signed; A's own -> 302", async () => {
    const foreign = await refusedWithoutSideEffects(404, () =>
      H.inspectGET(req("GET", "/api/products/product_b/inspect"), ctx({ id: "product_b" }))
    );
    const missing = await H.inspectGET(req("GET", "/api/products/nope/inspect"), ctx({ id: "nope" }));
    assert.equal(missing.status, 404);
    assert.deepEqual(await foreign.json(), await missing.json(), "not-yours and does-not-exist must be indistinguishable");

    const own = await H.inspectGET(req("GET", "/api/products/product_a/inspect"), ctx({ id: "product_a" }));
    assert.equal(own.status, 302);
    assert.deepEqual(state.signed, ["key_a"]);
  });

  test("POST /api/products/[id]/rescan -> 403; A's own passes authorization", async () => {
    await refusedWithoutSideEffects(403, () => H.rescanPOST(req("POST", "/api/products/product_b/rescan"), ctx({ id: "product_b" })));

    const own = await H.rescanPOST(req("POST", "/api/products/product_a/rescan"), ctx({ id: "product_a" }));
    assert.equal(own.status, 200, "a SAFE file reconciles rather than rescans");
    assert.equal((await own.json()).state, "passed");
    wroteOnlyA();
  });

  test("signed out: every product route answers 401 and writes nothing", async () => {
    signIn(null);
    await refusedWithoutSideEffects(401, () => H.productGET(req("GET", "/api/products/product_b"), ctx({ id: "product_b" })));
    await refusedWithoutSideEffects(401, () => H.productPUT(req("PUT", "/api/products/product_b", { name: "x" }), ctx({ id: "product_b" })));
    await refusedWithoutSideEffects(401, () => H.productDELETE(req("DELETE", "/api/products/product_b"), ctx({ id: "product_b" })));
    await refusedWithoutSideEffects(401, () =>
      H.productsPOST(req("POST", "/api/products", { name: "x", price: "1", shopId: "shop_b", certified: true }))
    );
    await refusedWithoutSideEffects(401, () => H.inspectGET(req("GET", "/api/products/product_b/inspect"), ctx({ id: "product_b" })));
    await refusedWithoutSideEffects(401, () => H.rescanPOST(req("POST", "/api/products/product_b/rescan"), ctx({ id: "product_b" })));
  });
});

/* ------------------------------- shops ------------------------------- */

describe("shops: seller A cannot reach shop_b", () => {
  beforeEach(() => signIn(SELLER_A));

  test("GET /api/shops/[slug] -> 403; A's own -> 200 with only A's products", async () => {
    await refusedWithoutSideEffects(403, () => H.shopGET(req("GET", "/api/shops/shop-b"), ctx({ slug: "shop-b" })));
    const own = await H.shopGET(req("GET", "/api/shops/shop-a"), ctx({ slug: "shop-a" }));
    assert.equal(own.status, 200);
    const body = await own.json();
    assert.deepEqual(body.products.map((p: Row) => p.id), ["product_a"]);
    assert.equal(body.shopUsers, undefined);
  });

  test("PUT /api/shops/[slug] -> 403, shop_b unchanged; A's own -> 200", async () => {
    await refusedWithoutSideEffects(403, () =>
      H.shopPUT(req("PUT", "/api/shops/shop-b", { name: "Hijacked", description: "x" }), ctx({ slug: "shop-b" }))
    );
    assert.equal(db.shop.find((s) => s.id === "shop_b")!.name, "Shop B");

    const own = await H.shopPUT(req("PUT", "/api/shops/shop-a", { name: "Shop A renamed" }), ctx({ slug: "shop-a" }));
    assert.equal(own.status, 200);
    wroteOnlyA();
  });

  test("GET /api/shops lists only the signed-in account's shops", async () => {
    const res = await H.shopsGET(req("GET", "/api/shops"));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).map((s: Row) => s.id), ["shop_a"]);
  });

  test("GET /api/shops/[slug]/payout-account -> 403, B's IBAN never in the reply; A's own -> 200", async () => {
    const res = await refusedWithoutSideEffects(403, () =>
      H.payoutGET(req("GET", "/api/shops/shop-b/payout-account"), ctx({ slug: "shop-b" }))
    );
    const text = await res.text();
    assert.ok(!text.includes(IBAN_B.slice(-4)) && !text.includes("Seller B"));

    const own = await H.payoutGET(req("GET", "/api/shops/shop-a/payout-account"), ctx({ slug: "shop-a" }));
    assert.equal(own.status, 200);
    const body = await own.json();
    assert.equal(body.account, null, "A has no account yet; B's must not show up");
    assert.equal(body.owed.orderCount, 1, "only A's payable order is counted");
  });

  test("PUT /api/shops/[slug]/payout-account -> 403, B's bank details unchanged; A's own -> 200", async () => {
    const before = JSON.stringify(db.sellerPayoutAccount);
    await refusedWithoutSideEffects(403, () =>
      H.payoutPUT(
        req("PUT", "/api/shops/shop-b/payout-account", { holderName: "Attacker", iban: IBAN_A, bankName: "X" }),
        ctx({ slug: "shop-b" })
      )
    );
    assert.equal(JSON.stringify(db.sellerPayoutAccount), before);

    const own = await H.payoutPUT(
      req("PUT", "/api/shops/shop-a/payout-account", { holderName: "Seller A", iban: IBAN_A, bankName: "Bank A" }),
      ctx({ slug: "shop-a" })
    );
    assert.equal(own.status, 200);
    assert.equal(db.sellerPayoutAccount.find((a) => a.shopId === "shop_b")!.iban, IBAN_B);
    wroteOnlyA();
  });

  test("signed out: shop routes answer 401", async () => {
    signIn(null);
    await refusedWithoutSideEffects(401, () => H.shopGET(req("GET", "/api/shops/shop-b"), ctx({ slug: "shop-b" })));
    await refusedWithoutSideEffects(401, () => H.shopPUT(req("PUT", "/api/shops/shop-b", { name: "Hijacked" }), ctx({ slug: "shop-b" })));
    await refusedWithoutSideEffects(401, () => H.shopsGET(req("GET", "/api/shops")));
    await refusedWithoutSideEffects(401, () => H.payoutGET(req("GET", "/api/shops/shop-b/payout-account"), ctx({ slug: "shop-b" })));
    await refusedWithoutSideEffects(401, () =>
      H.payoutPUT(req("PUT", "/api/shops/shop-b/payout-account", { holderName: "x", iban: IBAN_A }), ctx({ slug: "shop-b" }))
    );
  });
});

/* ------------------------------- orders ------------------------------ */

describe("orders: a seller sees only their own shop's sales", () => {
  test("GET /api/orders as A returns order_a1 and nothing of B's", async () => {
    signIn(SELLER_A);
    const res = await H.ordersGET();
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(body.orders.map((o: Row) => o.id), ["order_a1"]);
    assert.ok(!text.includes("product_b") && !text.includes("buyer-of-b@example.test") && !text.includes("Shop B"));
    assert.deepEqual(writes, []);
  });

  test("GET /api/orders as B is the mirror image", async () => {
    signIn(SELLER_B);
    const body = await (await H.ordersGET()).json();
    assert.deepEqual(body.orders.map((o: Row) => o.id), ["order_b1"]);
  });

  test("signed out -> 401", async () => {
    signIn(null);
    await refusedWithoutSideEffects(401, () => H.ordersGET());
  });
});

/* ---------------------------- AI listing ----------------------------- */

describe("AI listing: generating for shop_b is refused before the provider is called", () => {
  const input = (shopId: string) => ({ shopId, language: "en", category: "templates", title: "Weekly planner" });

  test("POST /api/ai/listing for shop_b -> 403, no provider call, no AiGeneration row", async () => {
    signIn(SELLER_A);
    const res = await refusedWithoutSideEffects(403, () => H.aiPOST(req("POST", "/api/ai/listing", input("shop_b"))));
    assert.equal((await res.json()).error, "FORBIDDEN");
    assert.equal(state.aiCalls, 0, "the billable provider must not be called for someone else's shop");
  });

  test("for shop_a -> 200, and the generation is recorded against shop_a", async () => {
    signIn(SELLER_A);
    const res = await H.aiPOST(req("POST", "/api/ai/listing", input("shop_a")));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(state.aiCalls, 1);
    assert.deepEqual(db.aiGeneration.map((g) => [g.userId, g.shopId]), [["user_a", "shop_a"]]);
    wroteOnlyA();
  });

  test("signed out -> 401", async () => {
    await refusedWithoutSideEffects(401, () => H.aiPOST(req("POST", "/api/ai/listing", input("shop_b"))));
    assert.equal(state.aiCalls, 0);
  });
});

/* ----------------------------- uploads ------------------------------- */

describe("uploads: the UploadThing middleware refuses another seller's shop", () => {
  test("all four upload routes are guarded", () => {
    assert.deepEqual(Object.keys(uploadRoutes).sort(), ["productFile", "productThumbnail", "shopCover", "shopLogo"]);
    for (const route of Object.values(uploadRoutes)) assert.equal(typeof route.middleware, "function");
  });

  for (const name of ["productFile", "productThumbnail", "shopLogo", "shopCover"]) {
    test(`${name}: A naming shop_b is refused; A naming shop_a passes with A's id`, async () => {
      signIn(SELLER_A);
      const route = uploadRoutes[name];
      await assert.rejects(route.middleware({ input: { shopId: "shop_b" } }), FakeUploadThingError);
      await assert.rejects(route.middleware({ input: { shopId: "shop_missing" } }), FakeUploadThingError);
      assert.deepEqual(await route.middleware({ input: { shopId: "shop_a" } }), { userId: "user_a", shopId: "shop_a" });
      signIn(null);
      await assert.rejects(route.middleware({ input: { shopId: "shop_a" } }), FakeUploadThingError);
      assert.deepEqual(writes, []);
    });
  }
});

/* ------------------------------- admin ------------------------------- */

/**
 * Every admin method, called the way an attacker would. The list must cover
 * exactly the routes ROUTE_POLICY marks "admin", so a new admin route needs a
 * behavioural case here as well as a policy line above.
 */
const ADMIN_CALLS: Record<string, () => Promise<Response>> = {
  "GET /api/admin/moderation": () => H.adminModerationGET(req("GET", "/api/admin/moderation")),
  "POST /api/admin/moderation/[productId]": () =>
    H.adminDecisionPOST(req("POST", "/api/admin/moderation/product_b", { action: "APPROVED" }), ctx({ productId: "product_b" })),
  "GET /api/admin/inspect/[productId]": () =>
    H.adminInspectGET(req("GET", "/api/admin/inspect/product_b"), ctx({ productId: "product_b" })),
  "GET /api/admin/payouts": () => H.adminPayoutsGET(req("GET", "/api/admin/payouts")),
  "POST /api/admin/payouts": () =>
    H.adminPayoutsPOST(
      req("POST", "/api/admin/payouts", {
        shopId: "shop_b",
        expectedAmount: "22.50",
        expectedOrderCount: 1,
        bankReference: "TRX-0001",
        paidOn: "2026-10-01",
        expectedAccountUpdatedAt: T0.toISOString(),
      })
    ),
};

describe("admin routes: refused to sellers and to the signed-out", () => {
  test("the behavioural list covers every admin route in ROUTE_POLICY", () => {
    const declared = Object.entries(ROUTE_POLICY)
      .filter(([, d]) => d.policy === "admin")
      .map(([k]) => k)
      .sort();
    assert.deepEqual(Object.keys(ADMIN_CALLS).sort(), declared);
  });

  for (const [key, call] of Object.entries(ADMIN_CALLS)) {
    test(`${key}: seller -> 403, signed out -> 403, admin gets through`, async () => {
      signIn(SELLER_A);
      await refusedWithoutSideEffects(403, call);
      signIn(SELLER_B); // B is no more an admin of B's own data than A is
      await refusedWithoutSideEffects(403, call);
      signIn(null);
      await refusedWithoutSideEffects([401, 403], call);

      signIn(ADMIN);
      const res = await call();
      assert.ok(![401, 403].includes(res.status), `admin refused: ${res.status} ${await res.clone().text()}`);
    });
  }

  test("an admin may rescan another shop's product (the route's documented exception)", async () => {
    signIn(ADMIN);
    const res = await H.rescanPOST(req("POST", "/api/products/product_b/rescan"), ctx({ id: "product_b" }));
    assert.equal(res.status, 200);
  });
});

describe("internal scan worker: a seller session is not a credential", () => {
  test("GET without the bearer -> 403 for a seller and for an admin session", async () => {
    signIn(SELLER_A);
    await refusedWithoutSideEffects(403, () => H.scanGET(req("GET", "/api/internal/scan")));
    signIn(ADMIN);
    await refusedWithoutSideEffects(403, () => H.scanGET(req("GET", "/api/internal/scan")));
    assert.equal(state.scanBatches, 0);
  });

  test("POST as a seller -> 403, and a wrong bearer -> 403", async () => {
    signIn(SELLER_A);
    await refusedWithoutSideEffects(403, () => H.scanPOST(req("POST", "/api/internal/scan", { key: "key_b" })));
    signIn(null);
    await refusedWithoutSideEffects(403, () =>
      H.scanPOST(req("POST", "/api/internal/scan", {}, { authorization: "Bearer wrong-secret-of-equal-len" }))
    );
    assert.equal(state.scanBatches, 0);
  });

  test("the right bearer gets through (positive control)", async () => {
    const res = await H.scanGET(req("GET", "/api/internal/scan", undefined, { authorization: `Bearer ${process.env.CRON_SECRET}` }));
    assert.equal(res.status, 200);
    assert.equal(state.scanBatches, 1);
  });
});
