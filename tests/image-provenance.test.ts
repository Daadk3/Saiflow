/**
 * Pictures belong to the shop that shows them (lib/image-provenance).
 *
 * What must hold:
 * - A thumbnail, logo or cover is accepted only when it was uploaded through
 *   its own route, for this shop, to SaiFlow's own storage.
 * - The routes check a picture only when it changes, after membership, and
 *   refuse with one message whatever the reason.
 */
import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const APP = "testapp123";
const url = (key: string, host = `${APP}.ufs.sh`) => `https://${host}/f/${key}`;
const assets = new Map<string, { shopId: string; route: string }>([
  ["thumbKeyShopA001", { shopId: "shop_a", route: "PRODUCT_THUMBNAIL" }],
  ["logoKeyShopA0001", { shopId: "shop_a", route: "SHOP_LOGO" }],
  ["fileKeyShopA0001", { shopId: "shop_a", route: "PRODUCT_FILE" }],
  ["logoKeyShopB0001", { shopId: "shop_b", route: "SHOP_LOGO" }],
]);

type Mod = typeof import("../lib/image-provenance.ts");
let mod: Mod;

before(async () => {
  process.env.UPLOADTHING_APP_ID = APP;
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        fileAsset: {
          findUnique: async ({ where }: { where: { key: string } }) => assets.get(where.key) ?? null,
        },
      },
    },
  });
  mod = await import("../lib/image-provenance.ts");
});

describe("the rule", () => {
  test("this shop's upload, through its own route: accepted", async () => {
    assert.deepEqual(await mod.verifyImageProvenance(url("thumbKeyShopA001"), "shop_a", "PRODUCT_THUMBNAIL"), { ok: true });
    assert.deepEqual(await mod.verifyImageProvenance(url("logoKeyShopA0001"), "shop_a", "SHOP_LOGO"), { ok: true });
  });

  test("another shop's upload, another route, or one we never recorded: refused", async () => {
    assert.deepEqual(await mod.verifyImageProvenance(url("logoKeyShopB0001"), "shop_a", "SHOP_LOGO"), { ok: false, reason: "wrong_shop" });
    assert.deepEqual(await mod.verifyImageProvenance(url("logoKeyShopA0001"), "shop_a", "SHOP_COVER"), { ok: false, reason: "wrong_route" });
    assert.deepEqual(await mod.verifyImageProvenance(url("fileKeyShopA0001"), "shop_a", "PRODUCT_THUMBNAIL"), { ok: false, reason: "wrong_route" }, "a deliverable is never a picture");
    assert.deepEqual(await mod.verifyImageProvenance(url("neverUploaded0001"), "shop_a", "SHOP_LOGO"), { ok: false, reason: "missing" });
  });

  test("anything not on SaiFlow's own storage is refused before any lookup", async () => {
    for (const bad of [url("logoKeyShopA0001", "otherapp.ufs.sh"), url("logoKeyShopA0001", "utfs.io"), "https://evil.example/f/logoKeyShopA0001", "not a url", 42, null]) {
      assert.deepEqual(await mod.verifyImageProvenance(bad, "shop_a", "SHOP_LOGO"), { ok: false, reason: "not_ours" }, String(bad));
    }
  });

  test("the verdict on its own", () => {
    assert.deepEqual(mod.imageProvenanceVerdict(null, "s", "SHOP_LOGO"), { ok: false, reason: "missing" });
    assert.deepEqual(mod.imageProvenanceVerdict({ shopId: "t", route: "SHOP_LOGO" }, "s", "SHOP_LOGO"), { ok: false, reason: "wrong_shop" });
    assert.deepEqual(mod.imageProvenanceVerdict({ shopId: "s", route: "SHOP_COVER" }, "s", "SHOP_LOGO"), { ok: false, reason: "wrong_route" });
    assert.deepEqual(mod.imageProvenanceVerdict({ shopId: "s", route: "SHOP_LOGO" }, "s", "SHOP_LOGO"), { ok: true });
  });
});

describe("the routes (structural)", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("creating a product checks the thumbnail after shop membership", () => {
    const src = strip(read("app/api/products/route.ts"));
    const member = src.indexOf("if (!shopUser)");
    const check = src.indexOf('verifyImageProvenance(thumbnailUrl, shopId, "PRODUCT_THUMBNAIL")');
    const create = src.indexOf("tx.product.create(");
    assert.ok(member > 0 && check > member && create > check);
  });

  test("editing a product checks a changed thumbnail only, against the product's own shop", () => {
    const src = strip(read("app/api/products/[id]/route.ts"));
    assert.ok(src.includes("if (thumbnailUrl && thumbnailUrl !== product.thumbnailUrl) {"));
    assert.ok(src.includes('verifyImageProvenance(thumbnailUrl, product.shopId, "PRODUCT_THUMBNAIL")'));
  });

  test("editing a shop checks a changed logo and cover, each through its own route, after membership", () => {
    const src = strip(read("app/api/shops/[slug]/route.ts"));
    const put = src.slice(src.indexOf("export async function PUT"));
    const member = put.indexOf("if (!userHasAccess)");
    const check = put.indexOf("verifyImageProvenance(value, shop.id, route)");
    const update = put.indexOf("prisma.shop.update(");
    assert.ok(member > 0 && check > member && update > check);
    assert.ok(put.includes('[logo, shop.logo, "SHOP_LOGO"]') && put.includes('[coverImage, shop.coverImage, "SHOP_COVER"]'));
    assert.ok(put.includes("if (value && value !== current)"));
  });

  test("one refusal for every reason", () => {
    assert.equal(mod.IMAGE_NOT_ALLOWED.code, "image_not_allowed");
    for (const file of ["app/api/products/route.ts", "app/api/products/[id]/route.ts", "app/api/shops/[slug]/route.ts"]) {
      assert.ok(read(file).includes("NextResponse.json(IMAGE_NOT_ALLOWED, { status: 400 })"), file);
    }
  });
});
