/**
 * The founder bot may create stores and pending products for one account,
 * and for nobody else. It cannot approve, and with the token unset it is not
 * there.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decideUpload } from "../lib/upload-accept.ts";
import { PRODUCT_FILE_CONFIG, PRODUCT_THUMBNAIL_CONFIG } from "../lib/upload-config.ts";
import { authorizeFounderBot, founderBotOwnerEmail, founderBotToken } from "../lib/founder-bot/gate.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const local = (p: string) => pathToFileURL(resolve(ROOT, p)).href;

const TOKEN = "founder-bot-test-token-0123456789";
const FOUNDER = "founder@saiflow.test";

/* ------------------------------------------------------------------ */
/* The door, with no database                                          */
/* ------------------------------------------------------------------ */

describe("the bot is off unless a real token is set", () => {
  beforeEach(() => {
    process.env.FOUNDER_BOT_API_TOKEN = TOKEN;
    process.env.FOUNDER_BOT_OWNER_EMAIL = FOUNDER;
    process.env.ADMIN_EMAILS = FOUNDER;
    process.env.FOUNDER_TEST_EMAILS = FOUNDER;
  });

  test("unset, blank, short, or spaced tokens do not count", () => {
    delete process.env.FOUNDER_BOT_API_TOKEN;
    assert.equal(founderBotToken(), null);
    process.env.FOUNDER_BOT_API_TOKEN = "   ";
    assert.equal(founderBotToken(), null);
    process.env.FOUNDER_BOT_API_TOKEN = "short-token";
    assert.equal(founderBotToken(), null);
    process.env.FOUNDER_BOT_API_TOKEN = `${TOKEN} tail`;
    assert.equal(founderBotToken(), null);
    process.env.FOUNDER_BOT_API_TOKEN = `  ${TOKEN}  `;
    assert.equal(founderBotToken(), TOKEN);
  });

  test("a wrong token is forbidden, and a missing one is not found", () => {
    delete process.env.FOUNDER_BOT_API_TOKEN;
    const off = authorizeFounderBot(new Request("https://saiflow.test/api/founder-bot/stores"));
    assert.equal(off.ok, false);
    if (!off.ok) assert.equal(off.response.status, 404);

    process.env.FOUNDER_BOT_API_TOKEN = TOKEN;
    const wrong = authorizeFounderBot(
      new Request("https://saiflow.test/api/founder-bot/stores", {
        headers: { authorization: "Bearer not-the-token-at-all-here", "x-forwarded-for": "203.0.113.10" },
      })
    );
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.response.status, 403);

    const mismatch = authorizeFounderBot(
      new Request("https://saiflow.test/api/founder-bot/stores", {
        headers: { authorization: "Bearer short", "x-forwarded-for": "203.0.113.11" },
      })
    );
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.response.status, 403);
  });

  test("the owner must be on both the admin list and the founder list", () => {
    assert.equal(founderBotOwnerEmail(), FOUNDER);

    process.env.FOUNDER_BOT_OWNER_EMAIL = "Founder@Saiflow.test";
    assert.equal(founderBotOwnerEmail(), FOUNDER);

    process.env.ADMIN_EMAILS = "someone-else@saiflow.test";
    assert.equal(founderBotOwnerEmail(), null);

    process.env.ADMIN_EMAILS = FOUNDER;
    process.env.FOUNDER_TEST_EMAILS = "someone-else@saiflow.test";
    assert.equal(founderBotOwnerEmail(), null);
  });

  test("the gate source never logs the token or the authorization header", () => {
    const gate = read("lib/founder-bot/gate.ts");
    assert.match(gate, /timingSafeEqual\(/);
    assert.ok(!/console\.\w+\([^)]*FOUNDER_BOT_API_TOKEN/.test(gate));
    assert.ok(!/console\.\w+\([^)]*authorization/i.test(gate));
    for (const file of ["app/api/founder-bot/stores/route.ts", "app/api/founder-bot/products/route.ts", "lib/founder-bot/upload.ts"]) {
      const src = read(file);
      assert.ok(!/console\.\w+\([^)]*FOUNDER_BOT_API_TOKEN/.test(src), file);
      assert.ok(!/console\.\w+\([^)]*authorization/i.test(src), file);
    }
  });
});

describe("upload decisions use the dashboard route config", () => {
  test("a pdf is a private deliverable, an executable is not", () => {
    const pdf = decideUpload(PRODUCT_FILE_CONFIG, { name: "guide.pdf", size: 1024, type: "application/pdf" });
    assert.equal(pdf.ok, true);
    if (pdf.ok) {
      assert.equal(pdf.acl, "private");
      assert.equal(pdf.contentDisposition, "attachment");
    }
    const exe = decideUpload(PRODUCT_FILE_CONFIG, { name: "setup.exe", size: 1024, type: "application/x-msdownload" });
    assert.deepEqual(exe, { ok: false, reason: "type" });
    const html = decideUpload(PRODUCT_FILE_CONFIG, { name: "index.html", size: 20, type: "text/html" });
    assert.equal(html.ok, false);
    const empty = decideUpload(PRODUCT_FILE_CONFIG, { name: "guide.pdf", size: 0, type: "application/pdf" });
    assert.deepEqual(empty, { ok: false, reason: "empty" });
  });

  test("a file over the route ceiling is refused, and a cover cannot be an svg", () => {
    const huge = decideUpload(PRODUCT_FILE_CONFIG, {
      name: "guide.pdf",
      size: 32 * 1024 * 1024 + 1,
      type: "application/pdf",
    });
    assert.deepEqual(huge, { ok: false, reason: "size" });
    const jpeg = decideUpload(PRODUCT_THUMBNAIL_CONFIG, { name: "cover.jpg", size: 2000, type: "image/jpeg" });
    assert.equal(jpeg.ok, true);
    if (jpeg.ok) assert.equal(jpeg.acl, undefined);
    const svg = decideUpload(PRODUCT_THUMBNAIL_CONFIG, { name: "cover.svg", size: 200, type: "image/svg+xml" });
    assert.equal(svg.ok, false);
  });
});

/* ------------------------------------------------------------------ */
/* Handlers against a fake database                                    */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {
  user: [],
  shop: [],
  shopUser: [],
  product: [],
  fileAsset: [],
  moderationEvent: [],
};
let seq = 0;
const nid = (p: string) => `${p}_${++seq}`;

const uploads: Array<{ name: string; size: number; type: string; opts: { acl?: string; contentDisposition?: string } }> = [];
const scheduled: string[] = [];
const notified: Array<Record<string, unknown>> = [];

function resetDb() {
  seq = 0;
  for (const key of Object.keys(db)) db[key] = [];
  db.user.push(
    { id: "user_founder", email: FOUNDER, name: "Daad" },
    { id: "user_other", email: "other@seller.test", name: "Other" }
  );
  db.shop.push({ id: "shop_other", slug: "other-shop", name: "Other shop", description: null, country: "SA", city: null, createdAt: new Date() });
  db.shopUser.push({ id: "su_other", userId: "user_other", shopId: "shop_other", role: "OWNER" });
  uploads.length = 0;
  scheduled.length = 0;
  notified.length = 0;
}

function emailEquals(where: Row | undefined, email: string): boolean {
  const clause = where?.email as { equals?: string } | undefined;
  return clause?.equals?.toLowerCase() === email.toLowerCase();
}

function pick(row: Row, select?: Row): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, want] of Object.entries(select)) {
    if (!want) continue;
    if (key === "_count") {
      const names = Object.keys((want as { select: Row }).select);
      const count: Row = {};
      for (const name of names) {
        count[name] = name === "products" ? db.product.filter((p) => p.shopId === row.id).length : 0;
      }
      out._count = count;
      continue;
    }
    out[key] = row[key];
  }
  return out;
}

const prisma = {
  user: {
    findFirst: async ({ where, select }: { where?: Row; select?: Row }) => {
      const row = db.user.find((u) => emailEquals(where, String(u.email)));
      return row ? pick(row, select) : null;
    },
    findUnique: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = db.user.find((u) => u.id === where.id);
      return row ? pick(row, select) : null;
    },
  },
  shop: {
    findUnique: async ({ where }: { where: Row }) => db.shop.find((s) => s.slug === where.slug) ?? null,
    findMany: async ({ where, select }: { where?: Row; select?: Row }) => {
      const some = (where?.shopUsers as { some?: Row } | undefined)?.some;
      return db.shop
        .filter((shop) =>
          db.shopUser.some(
            (su) =>
              su.shopId === shop.id &&
              (!some?.userId || su.userId === some.userId) &&
              (!some?.role || su.role === some.role)
          )
        )
        .map((shop) => pick(shop, select));
    },
    create: async ({ data, select }: { data: Row; select?: Row }) => {
      const nested = (data.shopUsers as { create?: Row } | undefined)?.create;
      const row: Row = {
        id: nid("shop"),
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        country: data.country ?? null,
        city: data.city ?? null,
        createdAt: new Date(),
      };
      db.shop.push(row);
      if (nested) {
        db.shopUser.push({
          id: nid("su"),
          shopId: row.id,
          userId: nested.userId,
          role: nested.role,
        });
      }
      return pick(row, select);
    },
  },
  shopUser: {
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = db.shopUser.find(
        (su) =>
          (!where.userId || su.userId === where.userId) &&
          (!where.shopId || su.shopId === where.shopId) &&
          (!where.role || su.role === where.role)
      );
      return row ? pick(row, select) : null;
    },
  },
  fileAsset: {
    upsert: async ({ where, create }: { where: Row; create: Row }) => {
      const existing = db.fileAsset.find((a) => a.key === where.key);
      if (existing) return existing;
      const row = { scanStatus: "PENDING_SCAN", scanSha256: null, scanAt: null, scanReason: null, contentFacts: null, ...create };
      db.fileAsset.push(row);
      return row;
    },
    findUnique: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = db.fileAsset.find((a) => a.key === where.key);
      return row ? pick(row, select) : null;
    },
  },
  product: {
    fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
    create: async ({ data }: { data: Row }) => {
      const row: Row = {
        id: nid("product"),
        moderationStatus: "PENDING",
        isActive: true,
        currency: "SAR",
        createdAt: new Date(),
        reviewChecks: null,
        ...data,
      };
      db.product.push(row);
      return row;
    },
    findUnique: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = db.product.find((p) => p.id === where.id);
      return row ? pick(row, select) : null;
    },
    findMany: async ({ where, select }: { where?: Row; select?: Row }) => {
      const some = (where?.shop as { shopUsers?: { some?: Row } } | undefined)?.shopUsers?.some;
      return db.product
        .filter((product) => {
          if (where?.shopId && product.shopId !== where.shopId) return false;
          if (!some) return true;
          return db.shopUser.some(
            (su) =>
              su.shopId === product.shopId &&
              su.userId === some.userId &&
              su.role === some.role
          );
        })
        .map((product) => pick(product, select));
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = db.product.filter((p) => p.id === where.id && (where.fileKey === undefined || p.fileKey === where.fileKey));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  },
  moderationEvent: {
    create: async ({ data }: { data: Row }) => {
      const row = { id: nid("event"), ...data };
      db.moderationEvent.push(row);
      return row;
    },
  },
  $transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(prisma as never),
};

let stores: typeof import("../app/api/founder-bot/stores/route.ts");
let products: typeof import("../app/api/founder-bot/products/route.ts");
let ip = 0;

describe("handlers", () => {

function authed(method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}): Request {
  ip += 1;
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-forwarded-for": `198.51.100.${ip}`,
      ...headers,
    },
  };
  if (body !== undefined) init.body = body;
  return new Request(`https://saiflow.test${path}`, init);
}

before(async () => {
  process.env.FOUNDER_BOT_API_TOKEN = TOKEN;
  process.env.FOUNDER_BOT_OWNER_EMAIL = FOUNDER;
  process.env.ADMIN_EMAILS = FOUNDER;
  process.env.FOUNDER_TEST_EMAILS = FOUNDER;
  process.env.UPLOADTHING_APP_ID = "app1";
  process.env.UPLOADTHING_TOKEN = "test-upload-token";

  mock.module("next-auth", { namedExports: { getServerSession: async () => null } });
  mock.module(local("app/api/auth/authOptions.ts"), { namedExports: { authOptions: {} } });
  mock.module(local("lib/prisma.ts"), { namedExports: { prisma } });
  mock.module(local("lib/scan/schedule.ts"), {
    namedExports: {
      scheduleScan: (key: string) => {
        scheduled.push(key);
        return true;
      },
    },
  });
  mock.module(local("lib/notify.ts"), {
    namedExports: {
      notifyAdminsStoreCreated: async (shop: Record<string, unknown>) => {
        notified.push(shop);
        return { ok: true, recipients: 1 };
      },
      notifyAdminsProductReadyForReview: async () => [{ ok: true }],
      notifyProductModerated: async () => ({ ok: true }),
      notifySaleFulfilled: async () => ({ ok: true }),
    },
  });
  mock.module("uploadthing/next", {
    namedExports: {
      createUploadthing: () => () => {
        const builder = {
          input: () => builder,
          middleware: () => builder,
          onUploadComplete: () => ({}),
        };
        return builder;
      },
    },
  });
  mock.module("uploadthing/server", {
    namedExports: {
      UploadThingError: class UploadThingError extends Error {},
      UTApi: class {
        async uploadFiles(file: File, opts: { acl?: string; contentDisposition?: string }) {
          uploads.push({ name: file.name, size: file.size, type: file.type, opts });
          const key = uploads.length === 1 ? "filekey01" : "coverkey1";
          return {
            data: {
              key,
              ufsUrl: `https://app1.ufs.sh/f/${key}`,
              name: file.name,
              size: file.size,
              type: file.type,
              url: `https://app1.ufs.sh/f/${key}`,
              appUrl: `https://app1.ufs.sh/f/${key}`,
              customId: null,
              fileHash: "abc",
            },
            error: null,
          };
        }
      },
    },
  });

  stores = await import("../app/api/founder-bot/stores/route.ts");
  products = await import("../app/api/founder-bot/products/route.ts");
});

beforeEach(() => {
  resetDb();
  process.env.FOUNDER_BOT_API_TOKEN = TOKEN;
  process.env.FOUNDER_BOT_OWNER_EMAIL = FOUNDER;
  process.env.ADMIN_EMAILS = FOUNDER;
  process.env.FOUNDER_TEST_EMAILS = FOUNDER;
  process.env.UPLOADTHING_APP_ID = "app1";
  process.env.UPLOADTHING_TOKEN = "test-upload-token";
});

describe("stores", () => {
  test("the API is 404 when the token is unset, and writes nothing", async () => {
    delete process.env.FOUNDER_BOT_API_TOKEN;
    const beforeShops = db.shop.length;
    const res = await stores.POST(
      authed("POST", "/api/founder-bot/stores", JSON.stringify({ name: "Nope", country: "SA" }), {
        "content-type": "application/json",
      })
    );
    assert.equal(res.status, 404);
    assert.equal(db.shop.length, beforeShops);
    assert.equal(db.shopUser.filter((su) => su.userId === "user_other").length, 1);
  });

  test("a store is owned by the founder, even if the body names someone else", async () => {
    const res = await stores.POST(
      authed(
        "POST",
        "/api/founder-bot/stores",
        JSON.stringify({ name: "متجر داد", description: "ملفات", country: "SA", city: "الرياض", userId: "user_other" }),
        { "content-type": "application/json" }
      )
    );
    assert.equal(res.status, 201, await res.clone().text());
    const body = await res.json();
    assert.equal(body.store.name, "متجر داد");
    const owners = db.shopUser.filter((su) => su.shopId === body.store.id);
    assert.deepEqual(
      owners.map((su) => ({ userId: su.userId, role: su.role })),
      [{ userId: "user_founder", role: "OWNER" }]
    );
    assert.equal(db.shopUser.filter((su) => su.userId === "user_other" && su.shopId === body.store.id).length, 0);
    assert.match(String(notified[0]?.creatorName), /founder bot/);

    const list = await stores.GET(authed("GET", "/api/founder-bot/stores"));
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.deepEqual(
      listed.stores.map((s: { id: string }) => s.id),
      [body.store.id]
    );
  });
});

describe("products", () => {
  async function ownShop(): Promise<string> {
    const res = await stores.POST(
      authed("POST", "/api/founder-bot/stores", JSON.stringify({ name: "Daad Store", country: "SA" }), {
        "content-type": "application/json",
      })
    );
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()).store.id as string;
  }

  function form(shopId: string, file: File, extra: Record<string, string> = {}, cover?: File): FormData {
    const data = new FormData();
    data.set("shopId", shopId);
    data.set("title", extra.title ?? "دليل التخطيط");
    data.set("description", extra.description ?? "وصف طويل بما يكفي للمشتري أن يفهم المنتج قبل الشراء.");
    data.set("price", extra.price ?? "49.00");
    data.set("category", extra.category ?? "ebooks");
    data.set("file", file);
    if (cover) data.set("cover", cover);
    return data;
  }

  test("another user's store is not found, and nothing is uploaded", async () => {
    const res = await products.POST(authed("POST", "/api/founder-bot/products", form("shop_other", new File(["%PDF"], "guide.pdf", { type: "application/pdf" }))));
    assert.equal(res.status, 404);
    assert.equal(uploads.length, 0);
    assert.equal(db.product.length, 0);
    assert.equal(scheduled.length, 0);
  });

  test("a file the dashboard would refuse is refused before upload", async () => {
    db.shop.push({ id: "shop_founder", slug: "daad", name: "Daad", description: null, country: "SA", city: null, createdAt: new Date() });
    db.shopUser.push({ id: "su_founder", userId: "user_founder", shopId: "shop_founder", role: "OWNER" });
    const shopId = "shop_founder";
    const res = await products.POST(
      authed("POST", "/api/founder-bot/products", form(shopId, new File(["MZ"], "setup.exe", { type: "application/x-msdownload" })))
    );
    assert.equal(res.status, 400);
    assert.match(await res.text(), /not allowed/);
    assert.equal(uploads.length, 0);
    assert.equal(db.product.filter((p) => p.shopId === shopId).length, 0);
  });

  test("a product is created pending, scanned, and checklist-flagged, and is not approved", async () => {
    const shopId = await ownShop();
    const res = await products.POST(
      authed(
        "POST",
        "/api/founder-bot/products",
        form(
          shopId,
          new File(["%PDF-1.4"], "guide.pdf", { type: "application/pdf" }),
          {},
          new File([new Uint8Array([0xff, 0xd8, 0xff])], "cover.jpg", { type: "image/jpeg" })
        )
      )
    );
    assert.equal(res.status, 201, await res.clone().text());
    const body = await res.json();
    assert.equal(body.moderationStatus, "PENDING");
    assert.equal(body.currency, "SAR");
    assert.equal(body.shopId, shopId);
    assert.equal(body.fileUrl, undefined);
    assert.equal(Object.hasOwn(body, "fileUrl"), false);

    const product = db.product.find((p) => p.id === body.id);
    assert.ok(product);
    assert.equal(product.moderationStatus, "PENDING");
    assert.equal(product.fileScanStatus, "PENDING_SCAN");
    assert.equal(db.moderationEvent.some((e) => e.newStatus === "APPROVED"), false);

    const event = db.moderationEvent.find((e) => e.productId === body.id);
    assert.equal(event?.action, "SUBMITTED");
    assert.equal(event?.newStatus, "PENDING");
    assert.equal(event?.actor, "founder-bot:user_founder");
    assert.match(String(event?.reason), /founder bot/);
    assert.equal(db.moderationEvent.some((e) => e.action === "APPROVED"), false);

    assert.deepEqual(
      uploads.map((u) => u.opts),
      [
        { acl: "private", contentDisposition: "attachment" },
        { contentDisposition: "inline" },
      ]
    );
    assert.deepEqual(scheduled, ["filekey01"]);
    const checks = product.reviewChecks as { version: number; points: Record<string, { state: string }> };
    assert.equal(checks.version, 1);
    assert.ok(checks.points["3"] && checks.points["6"] && checks.points["7"]);

    const list = await products.GET(authed("GET", `/api/founder-bot/products?shopId=${shopId}`));
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.equal(listed.products.length, 1);
    assert.equal(listed.products[0].moderationStatus, "PENDING");
    assert.equal(listed.products[0].checklist.length, 8);
    assert.equal(listed.products[0].fileUrl, undefined);

    const foreign = await products.GET(authed("GET", "/api/founder-bot/products?shopId=shop_other"));
    assert.equal(foreign.status, 404);
  });
});
});
