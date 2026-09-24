/**
 * The commission model, end to end: one module, one rule, everywhere.
 *
 * STRUCTURAL (source text) for the forms, the component, the order writers,
 * the schema and migration, the admin view and the copy: Node's runner
 * cannot render pages. The arithmetic itself is covered behaviourally in
 * tests/pricing.test.ts and the API in tests/orders-revenue.test.ts.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const ar = JSON.parse(read("messages/ar.json"));
const en = JSON.parse(read("messages/en.json"));

const CREATE = "app/dashboard/shop/[slug]/add-product/page.tsx";
const EDIT = "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|json|md)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the seller's live calculator", () => {
  test("both forms render the same breakdown component directly under the price field, fed by the raw input", () => {
    for (const page of [CREATE, EDIT]) {
      const src = read(page);
      assert.match(src, /import \{ PriceBreakdown \} from "@\/components\/PriceBreakdown";/, page);
      const help = src.indexOf('{t("dashboard.product.priceHelp")}');
      const breakdown = src.indexOf("<PriceBreakdown price={price} />");
      const category = src.indexOf("{/* Category */}");
      assert.ok(help > 0 && breakdown > help && category > breakdown, `${page}: breakdown sits under the price field`);
      assert.ok(!/price\s*\*\s*[\d.]/.test(src), `${page}: no arithmetic in the form`);
      assert.ok(!/0\.93|0\.07|93%|7%/.test(strip(src)), `${page}: no rate literal in the form`);
    }
  });

  test("the component computes nothing itself: it asks lib/pricing and formats the result", () => {
    const src = strip(read("components/PriceBreakdown.tsx"));
    assert.match(src, /import \{ commissionPercentLabel, halalasToNumber, priceBreakdown \} from "@\/lib\/pricing";/);
    assert.match(src, /priceBreakdown\(price\)/, "the seller-price parser, with the ceiling");
    assert.ok(!/[*/]\s*[\d.]/.test(src.replace(/className="[^"]*"/g, "")), "no arithmetic on money in the component");
    for (const word of ["Geidea", "processor", "processing", "رسوم الدفع", "VAT", "ضريبة"]) {
      assert.ok(!src.includes(word), `${word} must not appear: processor fees are not shown, tax is not claimed`);
    }
    assert.match(src, /aria-live="polite"/, "updates are announced as the seller types");
  });

  test("the words are the approved ones, in both languages, and the rate is not hard-coded in copy", () => {
    assert.deepEqual(ar.dashboard.product.breakdown, {
      salePrice: "سعر البيع",
      commission: "عمولة SaiFlow ({rate})",
      earnings: "صافي أرباحك",
      hint: "أدخل السعر لعرض صافي أرباحك",
    });
    assert.deepEqual(en.dashboard.product.breakdown, {
      salePrice: "Sale price",
      commission: "SaiFlow commission ({rate})",
      earnings: "Your earnings",
      hint: "Enter a price to see your earnings",
    });
    for (const loc of [ar, en]) {
      for (const v of Object.values(loc.dashboard.product.breakdown) as string[]) {
        assert.ok(!/7\s*%|٧٪/.test(v), "the percentage comes from the module, not the copy");
      }
    }
  });
});

describe("the Order snapshot", () => {
  const schema = read("prisma/schema.prisma");
  const order = schema.slice(schema.indexOf("model Order {"), schema.indexOf("model Order {") + schema.slice(schema.indexOf("model Order {")).indexOf("\n}\n"));

  test("five nullable columns, decimal money, never reinterpreting old rows", () => {
    for (const column of ["grossAmount", "platformFeeAmount", "sellerNetAmount"]) {
      assert.match(order, new RegExp(`${column}\\s+Decimal\\?\\s+@db\\.Decimal\\(10, 2\\)`), column);
    }
    assert.match(order, /commissionRateBps\s+Int\?/);
    assert.match(order, /commissionVersion\s+String\?/);
    assert.ok(!/grossAmount[^\n]*@default/.test(order), "no default: an old row has no split");
  });

  test("the migration adds exactly those columns and nothing else, additively", () => {
    const dir = readdirSync(resolve(ROOT, "prisma/migrations")).filter((d) => /^\d{14}_add_order_commission_snapshot$/.test(d));
    assert.equal(dir.length, 1, "one commission migration");
    const sql = read(`prisma/migrations/${dir[0]}/migration.sql`).replace(/--[^\n]*/g, "");
    const statements = sql.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    assert.equal(statements.length, 1);
    assert.equal(
      statements[0],
      'ALTER TABLE "Order" ADD COLUMN "grossAmount" DECIMAL(10,2), ADD COLUMN "platformFeeAmount" DECIMAL(10,2), ADD COLUMN "sellerNetAmount" DECIMAL(10,2), ADD COLUMN "commissionRateBps" INTEGER, ADD COLUMN "commissionVersion" TEXT'
    );
    assert.ok(!/NOT NULL|DEFAULT|UPDATE|DELETE|DROP|INSERT/i.test(sql), "nullable, no backfill, nothing removed");
  });

  test("both order writers snapshot the split from lib/pricing, and the live one refuses an unparseable amount", () => {
    const geidea = strip(read("app/api/webhooks/geidea/route.ts"));
    assert.match(geidea, /import \{ fromHalalas, saleBreakdown \} from "@\/lib\/pricing";/);
    const split = geidea.indexOf("const split = saleBreakdown(session.amount);");
    const refuse = geidea.indexOf('if (!split) throw new FulfilmentBlocked("amount_unparseable");');
    const create = geidea.indexOf("const created = await tx.order.create({");
    assert.ok(split > 0 && refuse > split && create > refuse, "split decided before the write, inside the transaction");
    for (const line of [
      "grossAmount: fromHalalas(split.grossHalalas)",
      "platformFeeAmount: fromHalalas(split.commissionHalalas)",
      "sellerNetAmount: fromHalalas(split.sellerNetHalalas)",
      "commissionRateBps: split.rateBps",
      "commissionVersion: split.version",
    ]) {
      assert.ok(geidea.includes(line), `geidea: ${line}`);
    }
    const stripe = strip(read("app/api/webhooks/stripe/route.ts"));
    assert.match(stripe, /const split = saleBreakdown\(product\.price\);/);
    assert.ok(stripe.includes("sellerNetAmount: fromHalalas(split.sellerNetHalalas)"));
  });

  test("nothing about verification, inquiry, download authorisation or moderation changed shape", () => {
    const geidea = strip(read("app/api/webhooks/geidea/route.ts"));
    for (const guard of ["verifyCallbackSignature", "inquiryDisagreement", "localMismatch", "already_fulfilled", "verification_mismatch", "invalid_signature"]) {
      assert.ok(geidea.includes(guard), `guard still present: ${guard}`);
    }
    assert.ok(read("app/api/download/[productId]/route.ts").length > 0);
  });
});

describe("the revenue views", () => {
  test("the seller's API and page distinguish gross, commission and net, real only, with test rows labelled", () => {
    const api = strip(read("app/api/orders/route.ts"));
    assert.match(api, /import \{ fromHalalas, parseMoney, sumMoney \} from "@\/lib\/pricing";/, "stored-money parsers, no ceiling");
    assert.ok(!/parseMoney\([^)]*\)\s*\?\?\s*0/.test(api), "nothing unreadable is coerced to zero");
    assert.match(api, /order\.paymentEnvironment === "PRODUCTION"/);
    assert.ok(!/\+ Number\(order\.price\)/.test(api), "no float sum of prices");
    const page = read("app/dashboard/sales/page.tsx");
    for (const key of ["sales.grossSales", "sales.commission", "sales.netEarnings", "sales.realOrders", "sales.realOnlyNote", "sales.testBadge", "sales.colCommission", "sales.colNet"]) {
      assert.ok(page.includes(`t("${key}")`) || page.includes(`t("${key}",`), `sales page uses ${key}`);
    }
    assert.match(page, /order\.isTest &&/);
    assert.match(page, /data\?\.totals\?\.real/);
    for (const loc of [ar, en]) {
      for (const key of ["grossSales", "commission", "netEarnings", "realOrders", "realOnlyNote", "testOrdersCount", "testBadge", "colCommission", "colNet", "noSplit"]) {
        assert.ok(loc.dashboard.sales[key], `sales.${key}`);
      }
    }
    assert.equal(ar.dashboard.sales.grossSales, "إجمالي المبيعات");
    assert.equal(ar.dashboard.sales.commission, "عمولة SaiFlow");
    assert.equal(ar.dashboard.sales.netEarnings, "صافي أرباحك");
  });

  test("the overview card shows the seller's real net earnings", () => {
    const page = read("app/dashboard/page.tsx");
    assert.match(page, /ordersData\.totals\?\.real\?\.net/);
    assert.match(page, /t\('dashboard\.netEarnings'\)/);
  });

  test("the platform side sees gross, commission, net and environment, computed in halalas", () => {
    const stats = strip(read("lib/admin-stats.ts"));
    assert.match(stats, /prisma\.order\.groupBy\(\{\s*by: \["paymentEnvironment"\]/);
    assert.match(stats, /_sum: \{ price: true, platformFeeAmount: true, sellerNetAmount: true \}/);
    assert.match(stats, /paymentEnvironment: "TEST"/);
    assert.ok(!/Number\([^)]*\)\s*\+/.test(stats), "no float sums");
    assert.match(stats, /import \{ fromHalalas, parseMoney \} from "@\/lib\/pricing";/, "the aggregate reader has no product ceiling");
    assert.ok(!/parseMoney\([^)]*\)\s*\?\?\s*0/.test(stats), "an unreadable aggregate is never coerced to zero");
    assert.match(stats, /unreadable revenue aggregate/);
    const page = read("app/dashboard/admin/page.tsx");
    // The three money labels are rendered from a list, `t(\`payments.${key}\`)`.
    for (const key of ["gross", "commission", "net"]) {
      assert.ok(page.includes(`["${key}", stats.revenue.real.${key}]`), `admin page lists ${key}`);
    }
    assert.match(page, /t\(`payments\.\$\{key\}`\)/);
    for (const key of ["payments.realOrders", "payments.testGross", "payments.testOrders"]) {
      assert.ok(page.includes(`t("${key}")`), `admin page uses ${key}`);
    }
    assert.match(page, /stats\.revenue\.real\.net/);
    assert.match(page, /stats\.revenue\.test\.gross/);
  });
});

describe("create and edit share one price validator", () => {
  test("both routes call validatePrice and answer with the shared wording", () => {
    for (const route of ["app/api/products/route.ts", "app/api/products/[id]/route.ts"]) {
      const src = strip(read(route));
      assert.match(src, /import \{ priceProblemMessage, validatePrice \} from "@\/lib\/pricing";/, route);
      assert.match(src, /const priceCheck = validatePrice\(price\);/, route);
      assert.match(src, /priceProblemMessage\(priceCheck\.reason\)/, route);
      assert.ok(!/Number\(price\)|parseFloat\(price\)|numericPrice/.test(src), `${route}: no second parser`);
    }
    assert.match(strip(read("app/api/products/route.ts")), /price: priceCheck\.price,/);
    assert.match(strip(read("app/api/products/[id]/route.ts")), /price: nextPrice !== undefined \? nextPrice : product\.price,/);
  });
});

describe("the old promise is gone", () => {
  test('no "Keep 95%" or "٩٥٪" anywhere in copy, pages or components', () => {
    const files = [...walk(resolve(ROOT, "messages")), ...walk(resolve(ROOT, "app")), ...walk(resolve(ROOT, "components")), ...walk(resolve(ROOT, "lib"))];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const claim of ["Keep 95", "95% of every", "٩٥٪", "بـ95", "keep 95"]) {
        assert.ok(!text.includes(claim), `${file.replace(ROOT, "")} still says ${claim}`);
      }
    }
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const claim of ["Keep 93", "93% of every", "٩٣٪", "بـ93"]) {
        assert.ok(!text.includes(claim), `${file.replace(ROOT, "")} still says ${claim}`);
      }
    }
    assert.ok(en.meta.description.includes("SaiFlow commission: 7%."));
    assert.ok(ar.meta.description.includes("عمولة SaiFlow: 7%."));
  });

  test("no tax or VAT claim was added with the commission", () => {
    for (const loc of [ar, en]) {
      const text = JSON.stringify(loc.dashboard.product.breakdown) + JSON.stringify(loc.dashboard.sales) + JSON.stringify(loc.admin.payments);
      assert.ok(!/VAT|ضريبة|tax/i.test(text));
    }
  });
});
