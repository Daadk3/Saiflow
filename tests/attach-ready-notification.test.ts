/**
 * H1 — a product written ALREADY SAFE must still be announced to the founder.
 *
 * When the attached FileAsset already carries a verdict, `attachedScanFields`
 * copies it onto the product in the same insert or update. The scan worker
 * skips the settled file and the reconciliation only moves PENDING_SCAN rows,
 * so before this fix the founder got nothing. These tests drive the REAL
 * create and replace routes, the REAL reconciliation, the REAL scan worker
 * and the REAL notifier against an in-memory Prisma stand-in that honours the
 * WHERE clauses those paths rely on (key binding, PENDING_SCAN guards, claim
 * leases, id lists, status filters). Only the mail SDK, the file bytes, the
 * scan provider and Next's `after` are replaced.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ScanFindings } from "../lib/scan/provider";

process.env.UPLOADTHING_APP_ID = "testapp";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fileUrl = (key: string) => `https://testapp.ufs.sh/f/${key}`;
const FOUNDER = "founder@example.test";
const ORIGIN = "https://preview.saiflow.test";

/* ------------------------------------------------------------------ */
/* A Prisma stand-in that honours WHERE and state                       */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
const db = {
  users: [] as Row[],
  shops: [] as Row[],
  shopUsers: [] as Row[],
  products: [] as Row[],
  fileAssets: [] as Row[],
  events: [] as Row[],
};
let seq = 0;

const num = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : NaN);

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!(cond as Row[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(cond as Row[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matches(row, cond as Row)) return false;
      continue;
    }
    const value = row[key];
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
      continue;
    }
    if (cond instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false;
      continue;
    }
    if (typeof cond === "object") {
      const c = cond as Row;
      if ("equals" in c) {
        if (c.mode === "insensitive" && typeof value === "string" && typeof c.equals === "string") {
          if (value.toLowerCase() !== c.equals.toLowerCase()) return false;
        } else if (value !== c.equals) return false;
      }
      if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
      if ("not" in c && value === c.not) return false;
      // SQL null semantics: a null never satisfies a comparison.
      if ("lt" in c && !(num(value) < num(c.lt))) return false;
      if ("lte" in c && !(num(value) <= num(c.lte))) return false;
      if ("gt" in c && !(num(value) > num(c.gt))) return false;
      if ("gte" in c && !(num(value) >= num(c.gte))) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function applyData(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date) && "increment" in (value as Row)) {
      row[key] = (row[key] as number) + ((value as Row).increment as number);
    } else {
      row[key] = value;
    }
  }
}

type Args = { select?: Row; include?: Row; where?: Row };

function relation(table: string, row: Row, name: string, sub: unknown): unknown {
  const args = (sub === true ? {} : sub) as Args;
  if (table === "product" && name === "shop") {
    const shop = db.shops.find((s) => s.id === row.shopId);
    return shop ? project("shop", shop, args) : null;
  }
  if (table === "shop" && name === "shopUsers") {
    return db.shopUsers.filter((su) => su.shopId === row.id && matches(su, args.where)).map((su) => project("shopUser", su, args));
  }
  if (table === "shopUser" && name === "user") {
    const user = db.users.find((u) => u.id === row.userId);
    return user ? project("user", user, args) : null;
  }
  throw new Error(`stand-in: unknown relation ${table}.${name}`);
}

const RELATIONS: Record<string, string[]> = { product: ["shop"], shop: ["shopUsers"], shopUser: ["user"] };

function project(table: string, row: Row, args: Args): Row {
  const rel = RELATIONS[table] ?? [];
  if (args.select) {
    const out: Row = {};
    for (const [key, sub] of Object.entries(args.select)) {
      if (!sub) continue;
      out[key] = rel.includes(key) ? relation(table, row, key, sub) : row[key];
    }
    return out;
  }
  const out: Row = { ...row };
  if (args.include) {
    for (const [key, sub] of Object.entries(args.include)) {
      if (sub) out[key] = relation(table, row, key, sub);
    }
  }
  return out;
}

const prisma = {
  user: { findFirst: async ({ where }: Args) => db.users.find((r) => matches(r, where)) ?? null },
  shopUser: { findFirst: async ({ where }: Args) => db.shopUsers.find((r) => matches(r, where)) ?? null },
  fileAsset: {
    findUnique: async (args: Args) => {
      const row = db.fileAssets.find((r) => matches(r, args.where));
      return row ? project("fileAsset", row, args) : null;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const row of db.fileAssets) if (matches(row, where)) { applyData(row, data); count++; }
      return { count };
    },
  },
  product: {
    fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
    create: async ({ data }: { data: Row }) => {
      const row: Row = {
        id: `prod_${++seq}`,
        description: null,
        category: null,
        thumbnailUrl: null,
        moderationStatus: "PENDING",
        fileScanStatus: "PENDING_SCAN",
        fileScanKey: null,
        fileScanSha256: null,
        fileScanAt: null,
        fileScanAttempts: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      db.products.push(row);
      return { ...row };
    },
    findUnique: async (args: Args) => {
      const row = db.products.find((r) => matches(r, args.where));
      return row ? project("product", row, args) : null;
    },
    findFirst: async (args: Args) => {
      const row = db.products.find((r) => matches(r, args.where));
      return row ? project("product", row, args) : null;
    },
    findMany: async (args: Args = {}) => db.products.filter((r) => matches(r, args.where)).map((r) => project("product", r, args)),
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = db.products.find((r) => matches(r, where));
      if (!row) throw new Error("stand-in: product not found");
      applyData(row, data);
      row.updatedAt = new Date();
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const row of db.products) if (matches(row, where)) { applyData(row, data); count++; }
      return { count };
    },
  },
  moderationEvent: {
    create: async ({ data }: { data: Row }) => { db.events.push({ ...data }); return {}; },
    createMany: async ({ data }: { data: Row[] }) => { db.events.push(...data); return { count: data.length }; },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
};

/* ------------------------------------------------------------------ */
/* The replaced edges                                                   */
/* ------------------------------------------------------------------ */

const sent: Array<{ to: string[]; subject: string; html: string }> = [];
const state = {
  session: null as unknown,
  afterTasks: [] as Array<() => Promise<void>>,
  afterThrows: false,
  throwOnSend: false,
};
class FakeResend {
  emails = {
    send: async (message: { to: string[]; subject: string; html: string }) => {
      if (state.throwOnSend) throw new Error("ECONNRESET");
      sent.push(message);
      return { data: { id: "email_1" }, error: null };
    },
  };
  constructor(key?: string) {
    if (!key) throw new Error("Missing API key.");
  }
}
const PDF_BYTES = (() => { const b = new Uint8Array(16); b.set([0x25, 0x50, 0x44, 0x46]); return b; })();
const CLEAN: ScanFindings = {
  clean: true, verifiedFileFormat: ".pdf", containsExecutable: false, containsInvalidFile: false,
  containsScript: false, containsPasswordProtectedFile: false, containsRestrictedFileFormat: false,
  containsMacros: false, containsXmlExternalEntities: false, containsInsecureDeserialization: false,
  containsHtml: false, containsUnsafeArchive: false, containsOleEmbeddedObject: false, virusNames: [],
};

let CREATE: (req: Request) => Promise<Response>;
let REPLACE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let scanFileAsset: (key: string) => Promise<{ key: string; outcome: string }>;
let reconcileProductScanState: (productId: string, fileKey: string) => Promise<{ reconciled: boolean; readyForReview: boolean }>;

before(async () => {
  mock.module("next/server", {
    namedExports: {
      after: (task: () => Promise<void>) => {
        if (state.afterThrows) throw new Error("`after` was called outside a request scope");
        state.afterTasks.push(task);
      },
      NextResponse: {
        json: (body: unknown, init?: ResponseInit) =>
          new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } }),
      },
    },
  });
  mock.module("next-auth", { namedExports: { getServerSession: async () => state.session } });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, { namedExports: { authOptions: {} } });
  mock.module("resend", { namedExports: { Resend: FakeResend } });
  mock.module("@/lib/prisma", { namedExports: { prisma } });
  mock.module("@/lib/scan/cloudmersive", {
    namedExports: { cloudmersiveProvider: { id: "fake", isConfigured: () => true, scan: async () => ({ ok: true, findings: CLEAN }) } },
  });
  mock.module("@/lib/storage/provider", {
    namedExports: { MAX_SCANNABLE_BYTES: 128 * 1024 * 1024, readPrivateObject: async () => ({ ok: true, bytes: PDF_BYTES }) },
  });
  const realPolicy = await import("../lib/scan/policy.ts");
  mock.module(pathToFileURL(resolve(ROOT, "lib/scan/policy.ts")).href, {
    namedExports: { ...realPolicy, structuralVerdict: () => ({ outcome: "ALLOW" }) },
  });
  for (const level of ["log", "info", "warn", "error", "debug"] as const) console[level] = () => undefined;
  CREATE = (await import("../app/api/products/route.ts")).POST as typeof CREATE;
  REPLACE = (await import("../app/api/products/[id]/route.ts")).PUT as typeof REPLACE;
  scanFileAsset = (await import("../lib/scan/run.ts")).scanFileAsset as typeof scanFileAsset;
  reconcileProductScanState = (await import("../lib/file-safety.ts")).reconcileProductScanState as typeof reconcileProductScanState;
});

let testNumber = 0;
beforeEach(() => {
  testNumber++;
  const account = `seller-${testNumber}@example.test`;
  db.users = [{ id: "user_1", email: account }];
  db.shops = [{ id: "shop_1", name: "متجر داد", slug: "daad-s-store" }];
  db.shopUsers = [{ id: "su_1", shopId: "shop_1", userId: "user_1", role: "OWNER" }];
  db.products = [];
  db.fileAssets = [];
  db.events = [];
  sent.length = 0;
  state.session = { user: { email: account } };
  state.afterTasks = [];
  state.afterThrows = false;
  state.throwOnSend = false;
  process.env.RESEND_API_KEY = "re_TEST_NOT_A_REAL_KEY";
  process.env.ADMIN_EMAILS = FOUNDER;
  process.env.NEXTAUTH_URL = ORIGIN;
});

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function seedAsset(key: string, scanStatus: string) {
  const settled = scanStatus !== "PENDING_SCAN";
  db.fileAssets.push({
    key, shopId: "shop_1", route: "PRODUCT_FILE", name: `${key}.pdf`, scanStatus,
    scanAttempts: settled ? 1 : 0, scanAt: settled ? new Date("2026-09-23T10:00:00Z") : null,
    scanReason: scanStatus === "SCAN_ERROR" ? "provider_network" : null,
    scanSha256: settled ? `sha_${key}` : null, scanClaimToken: null, scanClaimedAt: null, createdAt: new Date("2026-09-23T09:59:00Z"),
  });
}
const createReq = (body: Row) =>
  new Request("https://saiflow.test/api/products", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Habits check", price: 1, shopId: "shop_1", certified: true, ...body }),
  });
const replaceReq = (id: string, body: Row) =>
  new Request(`https://saiflow.test/api/products/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const create = (body: Row) => CREATE(createReq(body));
const replace = (id: string, body: Row) => REPLACE(replaceReq(id, body), { params: Promise.resolve({ id }) });
/** Run what waits for the response, in order, including the scheduled scan. */
async function drain() {
  while (state.afterTasks.length > 0) {
    const task = state.afterTasks.shift()!;
    await task();
  }
}
const product = (id: string) => db.products.find((p) => p.id === id)!;
const reviewLink = (id: string) => `href="${ORIGIN}/dashboard/admin/products/${id}/preview"`;
/** A PENDING product that already sells file `key` (SAFE and bound), as the route would have written it. */
async function seedSafeProduct(key: string, moderationStatus = "PENDING") {
  seedAsset(key, "SAFE");
  const res = await create({ fileUrl: fileUrl(key) });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  await drain();
  sent.length = 0;
  product(id).moderationStatus = moderationStatus;
  return id;
}

/* ------------------------------------------------------------------ */
/* 1–2. The H1 case: written already SAFE                              */
/* ------------------------------------------------------------------ */

describe("H1: a product written already SAFE is announced exactly once", () => {
  test("create with an already-SAFE file and PENDING moderation", async () => {
    seedAsset("keyAAAA0001", "SAFE");
    const res = await create({ fileUrl: fileUrl("keyAAAA0001") });
    const text = await res.text();
    assert.equal(res.status, 201, text);
    const { id } = JSON.parse(text) as { id: string };
    const row = product(id);
    assert.equal(row.fileScanStatus, "SAFE");
    assert.equal(row.fileScanKey, "keyAAAA0001", "the insert carried the verdict");
    assert.equal(sent.length, 0, "nothing before the response");
    await drain();
    assert.equal(sent.length, 1, "exactly one founder email");
    assert.deepEqual(sent[0].to, [FOUNDER]);
    assert.equal(sent[0].subject, "منتج بانتظار المراجعة: Habits check");
    assert.ok(sent[0].html.includes(reviewLink(id)), "the absolute review link");
    // The other two announcers had nothing to add.
    assert.deepEqual(await scanFileAsset("keyAAAA0001"), { key: "keyAAAA0001", outcome: "SKIPPED_SETTLED" });
    assert.equal((await reconcileProductScanState(id, "keyAAAA0001")).reconciled, false);
    await drain();
    assert.equal(sent.length, 1, "still exactly one");
  });

  test("replace the file with an already-SAFE one on a PENDING product", async () => {
    const id = await seedSafeProduct("keyAAAA0001");
    seedAsset("keyBBBB0002", "SAFE");
    const res = await replace(id, { fileUrl: fileUrl("keyBBBB0002") });
    assert.equal(res.status, 200, await res.text());
    assert.equal(product(id).fileScanKey, "keyBBBB0002");
    assert.equal(sent.length, 0, "nothing before the response");
    await drain();
    assert.equal(sent.length, 1, "exactly one founder email");
    assert.ok(sent[0].html.includes(reviewLink(id)));
  });

  test("an unchanged file on edit announces nothing", async () => {
    const id = await seedSafeProduct("keyAAAA0001");
    const res = await replace(id, { name: "Renamed", fileUrl: fileUrl("keyAAAA0001") });
    assert.equal(res.status, 200);
    await drain();
    assert.equal(sent.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 3–5. Never for decided products or bad verdicts                      */
/* ------------------------------------------------------------------ */

describe("no announcement for decided products or non-SAFE verdicts", () => {
  test("already-SAFE replacement on an APPROVED product", async () => {
    const id = await seedSafeProduct("keyAAAA0001", "APPROVED");
    seedAsset("keyBBBB0002", "SAFE");
    assert.equal((await replace(id, { fileUrl: fileUrl("keyBBBB0002") })).status, 200);
    await drain();
    assert.equal(sent.length, 0);
  });

  test("already-SAFE replacement on a REJECTED product", async () => {
    const id = await seedSafeProduct("keyAAAA0001", "REJECTED");
    seedAsset("keyBBBB0002", "SAFE");
    assert.equal((await replace(id, { fileUrl: fileUrl("keyBBBB0002") })).status, 200);
    await drain();
    assert.equal(sent.length, 0);
  });

  test("UNSAFE and SCAN_ERROR files, on create and on replace", async () => {
    for (const status of ["UNSAFE", "SCAN_ERROR"]) {
      seedAsset(`bad_${status}`, status);
      const res = await create({ fileUrl: fileUrl(`bad_${status}`), name: `Bad ${status}` });
      assert.equal(res.status, 201);
      const { id } = (await res.json()) as { id: string };
      assert.equal(product(id).fileScanStatus, status);
    }
    const id = await seedSafeProduct("keyAAAA0001");
    seedAsset("keyUUUU0003", "UNSAFE");
    assert.equal((await replace(id, { fileUrl: fileUrl("keyUUUU0003") })).status, 200);
    await drain();
    assert.equal(sent.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. The race, both interleavings, still once                          */
/* ------------------------------------------------------------------ */

describe("the scan/reconcile race still announces exactly once", () => {
  test("a file no product uses is never scanned, so the worker cannot settle ahead of the first attach", async () => {
    seedAsset("keyAAAA0001", "PENDING_SCAN");
    assert.deepEqual(await scanFileAsset("keyAAAA0001"), { key: "keyAAAA0001", outcome: "SKIPPED_NOT_ATTACHED" });
    assert.equal(sent.length, 0);
  });

  test("the file settled for a first product, then a second product attaches it: each announced exactly once", async () => {
    seedAsset("keyAAAA0001", "PENDING_SCAN");
    const first = await create({ fileUrl: fileUrl("keyAAAA0001"), name: "First" });
    assert.equal(first.status, 201);
    const { id: firstId } = (await first.json()) as { id: string };
    await drain(); // the scheduled scan settles the file and binds the first product
    assert.equal(product(firstId).fileScanStatus, "SAFE");
    assert.equal(sent.length, 1, "the worker announced the first product");
    assert.ok(sent[0].html.includes(reviewLink(firstId)));

    const second = await create({ fileUrl: fileUrl("keyAAAA0001"), name: "Second" });
    assert.equal(second.status, 201);
    const { id: secondId } = (await second.json()) as { id: string };
    assert.equal(product(secondId).fileScanKey, "keyAAAA0001", "written already SAFE");
    await drain(); // the announcement runs; the scheduled scan skips the settled file
    assert.equal(sent.length, 2, "the second product announced once, from the route");
    assert.ok(sent[1].html.includes(reviewLink(secondId)));
    assert.ok(!sent[1].html.includes(reviewLink(firstId)), "the first product is not announced again");
    for (const id of [firstId, secondId]) {
      assert.equal((await reconcileProductScanState(id, "keyAAAA0001")).reconciled, false);
    }
    await drain();
    assert.equal(sent.length, 2);
  });

  test("product exists first, the scheduled scan settles it: the worker announces, a later reconciliation is quiet", async () => {
    seedAsset("keyAAAA0001", "PENDING_SCAN");
    const res = await create({ fileUrl: fileUrl("keyAAAA0001") });
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as { id: string };
    assert.equal(product(id).fileScanStatus, "PENDING_SCAN");
    await drain(); // the scheduled scan runs here
    assert.equal(product(id).fileScanStatus, "SAFE");
    assert.equal(sent.length, 1, "the worker announced the product it bound");
    assert.equal((await reconcileProductScanState(id, "keyAAAA0001")).reconciled, false, "nothing left to move");
    await drain();
    assert.equal(sent.length, 1);
  });

  test("inserted PENDING_SCAN, the file settles, the reconciliation moves it: one announcement", async () => {
    seedAsset("keyAAAA0001", "PENDING_SCAN");
    const res = await create({ fileUrl: fileUrl("keyAAAA0001") });
    const { id } = (await res.json()) as { id: string };
    state.afterTasks = []; // pretend the scheduled scan never ran on this instance
    db.fileAssets[0].scanStatus = "SAFE";
    db.fileAssets[0].scanSha256 = "sha_keyAAAA0001";
    db.fileAssets[0].scanAt = new Date();
    const result = await reconcileProductScanState(id, "keyAAAA0001");
    assert.deepEqual([result.reconciled, result.readyForReview], [true, true]);
    await drain();
    assert.equal(sent.length, 1);
    assert.deepEqual(await scanFileAsset("keyAAAA0001"), { key: "keyAAAA0001", outcome: "SKIPPED_SETTLED" });
    assert.equal(sent.length, 1);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Failure cannot fail the seller                                    */
/* ------------------------------------------------------------------ */

describe("a notification failure cannot fail create or update", () => {
  test("the mail provider throws: 201 and 200 all the same, the rows are written", async () => {
    state.throwOnSend = true;
    seedAsset("keyAAAA0001", "SAFE");
    const res = await create({ fileUrl: fileUrl("keyAAAA0001") });
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as { id: string };
    await drain();
    assert.equal(sent.length, 0);
    assert.equal(product(id).fileScanStatus, "SAFE");
    seedAsset("keyBBBB0002", "SAFE");
    assert.equal((await replace(id, { fileUrl: fileUrl("keyBBBB0002") })).status, 200);
    await drain();
    assert.equal(product(id).fileScanKey, "keyBBBB0002");
  });

  test("outside a request scope the announcement runs inline and still cannot fail the write", async () => {
    state.afterThrows = true;
    state.throwOnSend = true;
    seedAsset("keyAAAA0001", "SAFE");
    const res = await create({ fileUrl: fileUrl("keyAAAA0001") });
    assert.equal(res.status, 201);
    assert.equal(state.afterTasks.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 8. Replaced again before the deferred email runs                     */
/* ------------------------------------------------------------------ */

describe("a replacement before the deferred email runs cancels the stale one", () => {
  test("replaced with an unscanned file: the stale email is dropped; the new file's own scan announces later", async () => {
    seedAsset("keyAAAA0001", "SAFE");
    const res = await create({ fileUrl: fileUrl("keyAAAA0001") });
    const { id } = (await res.json()) as { id: string };
    assert.equal(state.afterTasks.length, 2, "the announcement and the scan wait for the response");
    seedAsset("keyBBBB0002", "PENDING_SCAN");
    assert.equal((await replace(id, { fileUrl: fileUrl("keyBBBB0002") })).status, 200);
    assert.equal(product(id).fileScanStatus, "PENDING_SCAN");
    // Run only the first deferred task: keyA's announcement.
    await state.afterTasks.shift()!();
    assert.equal(sent.length, 0, "the send-time re-check cancelled the stale email");
    await drain(); // keyA's scan skips (settled); keyB's scan settles and binds
    assert.equal(product(id).fileScanKey, "keyBBBB0002");
    assert.equal(sent.length, 1, "exactly one, for the file the product now sells");
  });

  test("replaced with another already-SAFE file: the stale email is dropped, the new one is the only one", async () => {
    seedAsset("keyAAAA0001", "SAFE");
    const res = await create({ fileUrl: fileUrl("keyAAAA0001") });
    const { id } = (await res.json()) as { id: string };
    seedAsset("keyBBBB0002", "SAFE");
    assert.equal((await replace(id, { fileUrl: fileUrl("keyBBBB0002") })).status, 200);
    await drain();
    assert.equal(sent.length, 1, "keyA's announcement was bound to keyA and cancelled; keyB's went out");
    assert.ok(sent[0].html.includes(reviewLink(id)));
  });

  test("decided before the deferred email runs: cancelled", async () => {
    seedAsset("keyAAAA0001", "SAFE");
    const res = await create({ fileUrl: fileUrl("keyAAAA0001") });
    const { id } = (await res.json()) as { id: string };
    product(id).moderationStatus = "APPROVED";
    await drain();
    assert.equal(sent.length, 0);
  });
});
