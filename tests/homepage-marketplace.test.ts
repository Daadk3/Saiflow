/**
 * Homepage redesign: the two-sided marketplace proposition.
 *
 * Structural checks on the public homepage, its header and its copy. They
 * read the source files rather than rendering, in the same spirit as the
 * storefront-gate suite: the invariants are about what the page can and
 * cannot show, not about pixels.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ar = JSON.parse(read("messages/ar.json")) as Record<string, unknown>;
const en = JSON.parse(read("messages/en.json")) as Record<string, unknown>;

type Tree = { [k: string]: Tree | "s" };
function tree(o: unknown): Tree | "s" {
  if (typeof o === "string") return "s";
  assert.ok(o && typeof o === "object", "messages hold strings or objects only");
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, tree(v)]));
}
function strings(o: unknown, path = ""): [string, string][] {
  if (typeof o === "string") return [[path, o]];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
}

const page = read("app/page.tsx");
const navbar = read("components/Navbar.tsx");
const productCard = read("components/ProductCard.tsx");
const home = {
  hero: read("components/home/Hero.tsx"),
  paths: read("components/home/TwoPaths.tsx"),
  categories: read("components/home/CategoriesGrid.tsx"),
  featured: read("components/home/FeaturedProducts.tsx"),
  creator: read("components/home/CreatorValue.tsx"),
  steps: read("components/home/SellSteps.tsx"),
  buyer: read("components/home/BuyerFlow.tsx"),
  trust: read("components/home/TrustGrid.tsx"),
  finalCta: read("components/home/FinalCta.tsx"),
};

describe("copy: one namespace, both locales, nothing fabricated", () => {
  test("home, nav and cta have identical key trees in Arabic and English", () => {
    for (const ns of ["home", "nav", "cta"]) {
      assert.deepEqual(tree(ar[ns]), tree(en[ns]), ns);
    }
  });

  test("every homepage string is non-empty in both locales", () => {
    for (const [locale, m] of [["ar", ar], ["en", en]] as const) {
      for (const [path, value] of strings(m.home)) {
        assert.ok(value.trim().length > 0, `${locale}: home.${path} is empty`);
      }
    }
  });

  test("the required Arabic copy is present verbatim", () => {
    const h = ar.home as Record<string, Record<string, string>>;
    assert.equal(h.hero.title, "بع منتجك الرقمي. أو اكتشف منتجك القادم.");
    assert.equal(h.hero.primaryCta, "ابدأ البيع");
    assert.equal(h.hero.secondaryCta, "تصفح المنتجات");
    assert.equal(h.hero.trustLine, "متجر مجاني للبدء · دفع آمن · تسليم رقمي مباشر");
    const paths = h.paths as unknown as { title: string; sell: Record<string, string>; buy: Record<string, string> };
    assert.equal(paths.title, "ماذا تريد أن تفعل اليوم؟");
    assert.equal(paths.sell.title, "أبغى أبيع منتج رقمي");
    assert.equal(paths.sell.cta, "افتح متجرك");
    assert.equal(paths.buy.title, "أبغى أشتري منتج رقمي");
    assert.equal(paths.buy.cta, "تصفح المنتجات");
    assert.equal(h.categories.title, "أي شيء رقمي يمكن أن يجد مكانه هنا.");
    assert.equal(h.featured.title, "اكتشف منتجات تستحق التجربة");
    assert.equal(h.featured.viewProduct, "عرض المنتج");
    assert.equal(h.creator.title, "فكرتك تستحق متجرًا.");
    assert.equal(h.creator.cta, "افتح متجرك مجانًا");
    assert.equal(h.steps.title, "ابدأ البيع بثلاث خطوات");
    assert.equal(h.buyer.title, "اكتشف. اشترِ. حمّل.");
    assert.equal(h.trust.title, "مصمم للبيع الرقمي");
    assert.equal(h.finalCta.title, "جاهز تبدأ؟");
    const nav = ar.nav as Record<string, string>;
    assert.deepEqual(
      [nav.products, nav.categories, nav.howToSell, nav.pricing, nav.login, nav.startSelling],
      ["المنتجات", "الفئات", "كيف تبيع؟", "الأسعار", "تسجيل الدخول", "ابدأ البيع"]
    );
  });

  test("the fake sales block and the old hero demo are gone from both locales", () => {
    for (const [locale, m] of [["ar", ar], ["en", en]] as const) {
      const raw = JSON.stringify(m);
      assert.ok(!("hero" in m), `${locale}: top-level hero namespace must be gone`);
      assert.ok(!("stats" in m) && !("platform" in m), `${locale}: stats/platform namespaces must be gone`);
      for (const needle of ["saleLabel", "saleBuyer", "saleTime", "آخر عملية بيع", "Latest sale"]) {
        assert.ok(!raw.includes(needle), `${locale}: still contains ${needle}`);
      }
    }
  });

  test("no payment method is named that is not enabled", () => {
    for (const [, value] of strings(ar.home).concat(strings(en.home))) {
      assert.ok(!/apple pay|آبل باي|mada|مدى|visa|فيزا|mastercard/i.test(value), value);
    }
  });

  test("the illustrative panels are captioned as illustrations", () => {
    for (const m of [ar, en]) {
      const h = m.home as Record<string, Record<string, Record<string, string>>>;
      assert.ok(h.hero.mock.illustrative.length > 0);
      assert.ok(h.creator.mock.illustrative.length > 0);
    }
    assert.ok(/t\("mock\.illustrative"\)/.test(home.hero));
    assert.ok(/t\("mock\.illustrative"\)/.test(home.creator));
  });
});

describe("the homepage shows only what can be bought, and links to real routes", () => {
  test("the featured query keeps every visibility gate and never hand-rolls safety", () => {
    const code = strip(page);
    assert.ok(/\.\.\.SAFE_DELIVERABLE_WHERE/.test(code));
    assert.ok(/from "@\/lib\/file-safety"/.test(code));
    assert.ok(/isActive:\s*true/.test(code));
    assert.ok(/moderationStatus:\s*"APPROVED"/.test(code));
    assert.ok(/shop:\s*\{\s*isActive:\s*true\s*\}/.test(code));
    assert.ok(!/fileScanStatus:\s*"SAFE"/.test(code));
    assert.ok(/category:\s*true/.test(code), "the card needs the category");
    assert.ok(/export const dynamic = "force-dynamic"/.test(code));
  });

  test("the featured grid renders the shared product card", () => {
    const code = strip(home.featured);
    assert.ok(/from "@\/components\/ProductCard"/.test(code));
    assert.ok(/<ProductCard/.test(code));
    assert.ok(!/href=\{`\/shop/.test(code), "the card, not the grid, owns the product link");
  });

  test("the whole product card is one link to the canonical product route", () => {
    const code = strip(productCard);
    const href = code.indexOf("href={`/shop/${product.shop.slug}/product/${product.slug}`}");
    assert.ok(href !== -1, "canonical product href");
    // Around that href: the link opens before the image and closes after the CTA text.
    const link = code.lastIndexOf("<Link", href);
    const image = code.indexOf("<Image", href);
    const cta = code.indexOf("{viewLabel}", href);
    const close = code.indexOf("</Link>", href);
    assert.ok(link !== -1 && link < href && href < image && image < cta && cta < close);
    assert.ok(!/href="#"|onClick/.test(code), "no dead or scripted links");
  });

  test("the product card renders no coloured placeholder rectangle", () => {
    for (const code of [home.featured, productCard]) {
      assert.ok(!/linear-gradient\(/.test(code));
      assert.ok(!/hsl\(/.test(code));
    }
  });

  test("the two-path cards are whole-card links to signup and browse, with text-free illustrations", () => {
    const code = strip(home.paths);
    const seller = code.indexOf('href="/signup"');
    const buyer = code.indexOf('href="/browse"');
    assert.ok(seller !== -1 && buyer !== -1 && seller < buyer, "seller card first, buyer card second");
    assert.ok(/t\("sell\.title"\)/.test(code) && /t\("sell\.cta"\)/.test(code));
    assert.ok(/t\("buy\.title"\)/.test(code) && /t\("buy\.cta"\)/.test(code));
    // The illustrations are decorative: hidden from assistive tech and free of copy.
    const illustrations = code.match(/aria-hidden="true"[^>]*className="relative h-44[\s\S]*?<\/div>\n    <\/div>/g) ?? [];
    assert.equal(illustrations.length, 2);
    for (const block of illustrations) {
      assert.ok(!/t\(/.test(block), "no translated text inside an illustration");
      assert.ok(!/\d+\s*(SAR|ر\.س)/.test(block), "no prices inside an illustration");
    }
    assert.ok(/aria-hidden="true"/.test(code));
  });

  test("the empty state is real copy with real routes, not fake products", () => {
    const code = strip(home.featured);
    assert.ok(/products\.length === 0/.test(code));
    assert.ok(/t\("emptyTitle"\)/.test(code) && /t\("emptyBody"\)/.test(code));
    assert.ok(/href="\/signup"/.test(code) && /href="\/browse"/.test(code));
  });

  test("the homepage renders no sales, counts or activity", () => {
    for (const [name, code] of Object.entries(home)) {
      const s = strip(code);
      assert.ok(!/Math\.random|toLocaleString\(|sales|مبيعات|\+\d/.test(s), `${name} must not fabricate activity`);
    }
    assert.ok(!/TrustBadges|StatsSection|TrendingProductsSection|HeroSection/.test(page));
    for (const gone of ["HeroSection", "StatsSection", "CategoriesSection", "TrendingProductsSection", "FeaturesSection", "PlatformSection", "CTASection", "VideoSection"]) {
      assert.ok(!existsSync(resolve(ROOT, `components/home/${gone}.tsx`)), `${gone} should be removed`);
    }
  });

  test("category cards link to the browse filter for taxonomy slugs only", () => {
    const code = strip(home.categories);
    assert.ok(code.includes("href={`/browse?category=${slug}`}"));
    assert.ok(/slug:\s*ProductCategory/.test(code));
    for (const slug of ["ebooks", "courses", "templates", "art", "music", "software"]) {
      assert.ok(new RegExp(`slug:\\s*"${slug}"`).test(code), slug);
    }
  });

  test("every CTA on the page targets an existing public route", () => {
    const all = Object.values(home).join("\n");
    const hrefs = [...all.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 8);
    for (const href of hrefs) {
      assert.ok(["/signup", "/browse"].includes(href), `unexpected static href ${href}`);
    }
    assert.ok(existsSync(resolve(ROOT, "app/signup/page.tsx")));
    assert.ok(existsSync(resolve(ROOT, "app/browse/page.tsx")));
  });

  test("the two-path section sits directly under the hero", () => {
    const code = strip(page);
    const hero = code.indexOf("<Hero />");
    const paths = code.indexOf("<TwoPaths />");
    const categories = code.indexOf("<CategoriesGrid />");
    assert.ok(hero !== -1 && paths !== -1 && categories !== -1);
    assert.ok(hero < paths && paths < categories);
  });

  test("the section anchors the header points at exist", () => {
    assert.ok(/id="categories"/.test(home.categories));
    assert.ok(/id="how-to-sell"/.test(home.steps));
  });
});

describe("header: four links and two actions", () => {
  test("desktop and mobile menus carry products, categories, how to sell and pricing", () => {
    const code = strip(navbar);
    for (const [href, key] of [
      ["/browse", "products"],
      ["/#categories", "categories"],
      ["/#how-to-sell", "howToSell"],
      ["/pricing", "pricing"],
    ]) {
      const count = code.split(`href="${href}"`).length - 1;
      assert.equal(count, 2, `${href} appears once per menu`);
      assert.ok(code.includes(`t('${key}')`), key);
    }
    assert.ok(!/href="\/blog"|href="\/docs"/.test(code), "blog and docs left the header");
    assert.ok(!/aria-label=\{t\('search'\)\}/.test(code), "the search icon is gone");
  });

  test("logged-out actions are login and the primary start-selling CTA", () => {
    const code = strip(navbar);
    assert.ok(code.includes('href="/login"'));
    assert.ok(/href="\/signup"[\s\S]{0,80}className="btn-primary/.test(code));
    assert.ok(/existsSync/.test("existsSync") && existsSync(resolve(ROOT, "app/pricing/page.tsx")));
    assert.ok(existsSync(resolve(ROOT, "app/login/page.tsx")));
  });

  test("the header still carries the logo and the language switcher", () => {
    assert.ok(/\/mascot\.png/.test(navbar));
    assert.ok(/<LanguageSwitcher \/>/.test(navbar));
  });
});
