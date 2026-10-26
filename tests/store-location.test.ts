/**
 * Store location: a required ISO country and an optional city, saved on the
 * shop. Saudi Arabia leads the dropdown, and every option is labeled in
 * Arabic and English. Existing shops have neither, and stay that way until
 * a seller sets them.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CITY_MAX_LENGTH,
  STORE_COUNTRIES,
  UNKNOWN_COUNTRY_FILTER,
  canonicalCountry,
  countryOptionLabel,
  parseCountryFilter,
  parseNewStoreLocation,
  parseStoreLocationPatch,
} from "../lib/store-location.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("the country dropdown", () => {
  test("Saudi Arabia is first, every code is a real country, and labels are Arabic and English", () => {
    assert.equal(STORE_COUNTRIES[0], "SA");
    assert.equal(new Set(STORE_COUNTRIES).size, STORE_COUNTRIES.length);
    assert.ok(STORE_COUNTRIES.length > 180);
    const label = countryOptionLabel("SA");
    assert.ok(label.includes("السعودية"), label);
    assert.ok(label.includes("Saudi Arabia"), label);
    assert.equal(canonicalCountry("sa"), "SA");
    assert.equal(canonicalCountry(" SA "), "SA");
    assert.equal(canonicalCountry("Saudi Arabia"), null);
    assert.equal(canonicalCountry("XX"), null);
  });
});

describe("creating a store", () => {
  test("country is required and city is optional", () => {
    assert.deepEqual(parseNewStoreLocation({ country: "SA", city: undefined }), {
      ok: true,
      country: "SA",
      city: null,
    });
    assert.deepEqual(parseNewStoreLocation({ country: "ae", city: "  أبوظبي  " }), {
      ok: true,
      country: "AE",
      city: "أبوظبي",
    });
    const missing = parseNewStoreLocation({ country: "", city: null });
    assert.equal(missing.ok, false);
    const named = parseNewStoreLocation({ country: "مصر", city: null });
    assert.equal(named.ok, false);
  });

  test("a city is trimmed, stripped of control characters, and bounded", () => {
    assert.deepEqual(parseNewStoreLocation({ country: "SA", city: "جدة\n" }), {
      ok: true,
      country: "SA",
      city: "جدة",
    });
    assert.equal(parseNewStoreLocation({ country: "SA", city: "   " }).ok && true, true);
    const blank = parseNewStoreLocation({ country: "SA", city: " \n " });
    assert.equal(blank.ok && blank.city, null);
    const long = parseNewStoreLocation({ country: "SA", city: "م".repeat(CITY_MAX_LENGTH + 1) });
    assert.equal(long.ok, false);
    const exact = parseNewStoreLocation({ country: "SA", city: "م".repeat(CITY_MAX_LENGTH) });
    assert.equal(exact.ok, true);
    assert.equal(parseNewStoreLocation({ country: "SA", city: 12 }).ok, false);
  });
});

describe("editing a store", () => {
  test("keys that are absent do not clear anything", () => {
    assert.deepEqual(parseStoreLocationPatch({ name: "متجر" }), { ok: true });
  });

  test("a country can be set or returned to unknown, and a city can be cleared", () => {
    assert.deepEqual(parseStoreLocationPatch({ country: "kw", city: "حولي" }), {
      ok: true,
      country: "KW",
      city: "حولي",
    });
    assert.deepEqual(parseStoreLocationPatch({ country: null, city: "" }), {
      ok: true,
      country: null,
      city: null,
    });
    assert.equal(parseStoreLocationPatch({ country: "Narnia" }).ok, false);
  });
});

describe("the admin filter", () => {
  test("a bad value shows every store, and unknown is its own choice", () => {
    assert.equal(parseCountryFilter(undefined), undefined);
    assert.equal(parseCountryFilter("  "), undefined);
    assert.equal(parseCountryFilter("nope"), undefined);
    assert.equal(parseCountryFilter("sa"), "SA");
    assert.equal(parseCountryFilter(" Unknown "), UNKNOWN_COUNTRY_FILTER);
  });
});

describe("the migration", () => {
  test("it only adds nullable columns and an index on Shop", () => {
    const sql = read("prisma/migrations/20261026120000_add_shop_location/migration.sql").replace(/--[^\n]*/g, "");
    assert.match(sql, /ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "country" TEXT/);
    assert.match(sql, /ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "city" TEXT/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS "Shop_country_idx" ON "Shop"\("country"\)/);
    assert.ok(!/\b(DELETE|UPDATE|DROP|TRUNCATE)\b/i.test(sql));
    assert.ok(!/PaymentSession|"Order"|"Product"/i.test(sql));
  });
});

describe("the forms and both languages", () => {
  test("creation requires the country, and settings can still leave an older store unknown", () => {
    const create = read("app/dashboard/create-shop/page.tsx");
    const edit = read("app/dashboard/shop/[slug]/edit/page.tsx");
    assert.ok(create.includes("<StoreLocationFields"));
    assert.match(create, /countryRequired\s*\/>/);
    assert.ok(edit.includes("countryRequired={false}"));
    assert.ok(create.includes("country,"));
    assert.ok(edit.includes("country: country || null"));
  });

  test("Arabic and English use the same location words", () => {
    const keys = [
      "countryLabel",
      "countryPlaceholder",
      "countryRequired",
      "countryUnknown",
      "cityLabel",
      "cityOptional",
      "cityPlaceholder",
      "locationHelp",
    ];
    for (const lang of ["ar", "en"]) {
      const createShop = JSON.parse(read(`messages/${lang}.json`)).dashboard.createShop;
      for (const key of keys) assert.ok(createShop[key], `${lang} ${key}`);
    }
    const ar = JSON.parse(read("messages/ar.json")).dashboard.createShop.countryPlaceholder as string;
    assert.ok(/[\u0600-\u06FF]/.test(ar), ar);
  });
});
