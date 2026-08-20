/**
 * B-1 — the direct product link must survive a rename.
 *
 * THE DEFECT. The public product URL is
 * `/shop/{shopSlug}/product/{productSlug}`, and both halves used to be
 * regenerated whenever the corresponding name changed. Nothing redirects from
 * an old handle and the public page turns a miss into notFound(), so a creator
 * who shared a link and later edited the title silently killed every share.
 * Renaming a SHOP was worse: it broke every product link in that shop at once.
 *
 * In Arabic — the primary market — it was worse still. `slugBase` strips
 * non-Latin characters to an empty string, so `slugify` falls back to
 * `product-<random>`; a rename therefore swapped the URL for an entirely
 * unrelated new handle rather than a differently-worded one.
 *
 * THE FIX. Neither update statement writes the slug column any more. Prisma
 * leaves a column it is not given alone, so no slug in the database changes
 * and every URL that works today keeps working — which is what "existing URLs
 * remain unchanged" means here: not that they are rewritten to match, but that
 * nothing writes them at all.
 *
 * WHAT THESE TESTS PIN. Not the wording of a slug — the ABSENCE of a write.
 * The assertions read the arguments actually handed to `prisma.*.update`, so a
 * future edit that reintroduces the write fails here even if it computes the
 * same string. Creation is deliberately untouched and is re-asserted below, so
 * "freeze" cannot quietly become "never generate".
 *
 * No database and no network: Prisma is mocked and the calls are captured.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { slugify, slugBase } from "../lib/slug";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Comments explain the trap; they must never satisfy an assertion. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const PRODUCT_ROUTE = "app/api/products/[id]/route.ts";
const SHOP_ROUTE = "app/api/shops/[slug]/route.ts";

const ORIGINAL_PRODUCT_SLUG = "my-ebook";
const ORIGINAL_SHOP_SLUG = "daad-s-store";

/* ================================================================== */
/* 1. Neither update writes the slug column                            */
/* ================================================================== */

const calls = {
  productUpdate: [] as Record<string, unknown>[],
  shopUpdate: [] as Record<string, unknown>[],
};
const state = {
  session: null as unknown,
  user: null as unknown,
  product: null as unknown,
  shop: null as unknown,
};

let productPUT: (
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) => Promise<Response>;
let shopPUT: (
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) => Promise<Response>;

before(async () => {
  mock.module("next-auth", {
    namedExports: { getServerSession: async () => state.session },
  });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, {
    namedExports: { authOptions: {} },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        // file-safety builds a where-clause at load time from this.
        product: {
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
          findUnique: async () => state.product,
          update: async (args: Record<string, unknown>) => {
            calls.productUpdate.push(args);
            return { ...(state.product as object), ...(args.data as object) };
          },
        },
        shop: {
          findUnique: async () => state.shop,
          update: async (args: Record<string, unknown>) => {
            calls.shopUpdate.push(args);
            return { ...(state.shop as object), ...(args.data as object) };
          },
        },
        user: { findFirst: async () => state.user },
      },
    },
  });

  productPUT = (await import("../app/api/products/[id]/route.ts"))
    .PUT as typeof productPUT;
  shopPUT = (await import("../app/api/shops/[slug]/route.ts"))
    .PUT as typeof shopPUT;
});

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod_1",
    name: "My eBook",
    slug: ORIGINAL_PRODUCT_SLUG,
    description: "A book",
    price: 25,
    currency: "SAR",
    category: null,
    fileUrl: null,
    fileKey: null,
    thumbnailUrl: null,
    shop: {
      id: "shop_1",
      name: "Daad's Store",
      slug: ORIGINAL_SHOP_SLUG,
      shopUsers: [{ userId: "user_1" }],
    },
    ...overrides,
  };
}

function shopRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "shop_1",
    name: "Daad's Store",
    slug: ORIGINAL_SHOP_SLUG,
    description: null,
    logo: null,
    coverImage: null,
    shopUsers: [{ user: { email: "owner@saiflow.test" } }],
    ...overrides,
  };
}

const renameProduct = (name: string) =>
  productPUT(
    new Request("https://saiflow.test/api/products/prod_1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ id: "prod_1" }) }
  );

const renameShop = (name: string) =>
  shopPUT(
    new Request("https://saiflow.test/api/shops/daad-s-store", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ slug: ORIGINAL_SHOP_SLUG }) }
  );

beforeEach(() => {
  calls.productUpdate = [];
  calls.shopUpdate = [];
  state.session = { user: { email: "owner@saiflow.test" } };
  state.user = { id: "user_1", email: "owner@saiflow.test" };
  state.product = productRow();
  state.shop = shopRow();
});

describe("renaming a product never rewrites its slug", () => {
  test("an English rename writes no slug at all", async () => {
    const res = await renameProduct("My Guide");
    assert.equal(res.status, 200);
    assert.equal(calls.productUpdate.length, 1);
    const data = calls.productUpdate[0].data as Record<string, unknown>;
    assert.ok(!("slug" in data), `slug was written: ${JSON.stringify(data)}`);
    assert.equal(data.name, "My Guide", "the name itself must still update");
  });

  test("an Arabic rename writes no slug either", async () => {
    // The worst case before the fix: slugBase strips this to "", so the old
    // code minted a fresh random handle unrelated to the previous URL.
    await renameProduct("دليل التسويق الرقمي");
    const data = calls.productUpdate[0].data as Record<string, unknown>;
    assert.ok(!("slug" in data));
  });

  test("repeated renames still write no slug", async () => {
    await renameProduct("Second Name");
    state.product = productRow({ name: "Second Name" });
    await renameProduct("Third Name");
    assert.equal(calls.productUpdate.length, 2);
    for (const call of calls.productUpdate) {
      assert.ok(!("slug" in (call.data as Record<string, unknown>)));
    }
  });

  test("the update targets one row by id and cannot touch another", async () => {
    await renameProduct("My Guide");
    assert.deepEqual(calls.productUpdate[0].where, { id: "prod_1" });
  });

  test("no update statement mentions slug under any request shape", async () => {
    for (const name of ["My Guide", "دليل", "A", "x".repeat(80)]) {
      calls.productUpdate = [];
      state.product = productRow();
      await renameProduct(name);
      for (const call of calls.productUpdate) {
        assert.ok(
          !JSON.stringify(call.data).includes("slug"),
          `slug leaked into the update for: ${name}`
        );
      }
    }
  });
});

describe("renaming a shop never rewrites its slug", () => {
  test("an English rename writes no slug at all", async () => {
    const res = await renameShop("Daad Studio");
    assert.equal(res.status, 200);
    assert.equal(calls.shopUpdate.length, 1);
    const data = calls.shopUpdate[0].data as Record<string, unknown>;
    assert.ok(!("slug" in data), `slug was written: ${JSON.stringify(data)}`);
    assert.equal(data.name, "Daad Studio");
  });

  test("an Arabic rename writes no slug either", async () => {
    await renameShop("متجر دعد");
    const data = calls.shopUpdate[0].data as Record<string, unknown>;
    assert.ok(!("slug" in data));
  });

  test("the update targets the shop by id", async () => {
    await renameShop("Daad Studio");
    assert.deepEqual(calls.shopUpdate[0].where, { id: "shop_1" });
  });
});

/* ================================================================== */
/* 2. The routes no longer compute a slug at all                       */
/* ================================================================== */

describe("neither edit route can regenerate a handle", () => {
  for (const route of [PRODUCT_ROUTE, SHOP_ROUTE]) {
    test(`${route} makes no call to slugify`, () => {
      const code = strip(read(route));
      assert.equal(
        code.includes("slugify"),
        false,
        "slugify must not be called on an edit path"
      );
    });

    test(`${route} imports nothing from lib/slug`, () => {
      const code = strip(read(route));
      assert.ok(!/from\s+["']@\/lib\/slug["']/.test(code));
    });

    test(`${route} writes no slug into any data block`, () => {
      const code = strip(read(route));
      // Reads are fine — `slug: true` in a select, `slug` in a where, and
      // echoing a stored slug back in a response are all untouched. What must
      // not appear is an assignment into an update payload.
      assert.ok(!/\bslug:\s*(newSlug|slug)\b/.test(code));
      assert.ok(!/\n\s+slug,\s*\n/.test(code));
    });
  }
});

/* ================================================================== */
/* 3. Creation is untouched — freeze must not become "never generate"  */
/* ================================================================== */

describe("create-time slug generation still works", () => {
  for (const route of ["app/api/products/route.ts", "app/api/shops/route.ts"]) {
    test(`${route} still calls slugify`, () => {
      const code = strip(read(route));
      assert.ok(code.includes("slugify("), `${route} stopped generating slugs`);
    });
  }

  test("lib/slug is unchanged in behaviour: Latin names stay readable", () => {
    assert.equal(slugify("My eBook", "product"), "my-ebook");
    assert.equal(slugify("Daad's Store", "shop"), "daad-s-store");
  });

  test("non-Latin names still fall back to a usable handle", () => {
    const s = slugify("دليل التسويق", "product");
    assert.match(s, /^product-[a-z0-9]{1,6}$/);
    assert.equal(slugBase("دليل التسويق"), "");
  });

  test("the deterministic backfill form still works", () => {
    assert.equal(slugify("دليل", "product", "xloev1kn"), "product-xloev1kn");
  });
});

/* ================================================================== */
/* 4. Nothing that authorises or delivers depends on a slug            */
/* ================================================================== */

describe("no authorization, delivery or payment path keys off a slug", () => {
  const CRITICAL = [
    "app/api/checkout/route.ts",
    "app/api/download/[productId]/route.ts",
    "app/api/admin/inspect/[productId]/route.ts",
  ];

  for (const route of CRITICAL) {
    test(`${route} resolves its subject by id, not by slug`, () => {
      const code = strip(read(route));
      // A slug may appear as display data (a Stripe cancel_url, an email
      // line). It may never appear in a WHERE that selects the row being
      // authorised, because that is what would make a frozen or changed
      // handle a security question rather than a cosmetic one.
      assert.ok(
        !/where:\s*\{[^}]*\bslug\b[^}]*\}/.test(code),
        `${route} looks up by slug`
      );
    });
  }

  test("this change touched none of them", () => {
    // Pinned by content rather than by git: these files must not have been
    // edited to accommodate the freeze.
    for (const route of CRITICAL) {
      const code = strip(read(route));
      assert.ok(!code.includes("slugify"), `${route} now computes a slug`);
    }
  });

  test("the E2 safety gate is untouched", () => {
    const src = read("lib/file-safety.ts");
    assert.ok(src.includes("product.fileKey !== null &&"));
    assert.ok(src.includes('product.fileScanStatus === "SAFE" &&'));
    assert.ok(src.includes("product.fileScanKey === product.fileKey"));
    assert.ok(
      src.includes("fileScanKey: { equals: prisma.product.fields.fileKey }")
    );
  });
});
