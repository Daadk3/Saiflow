/**
 * Fixes from the 17 October 2026 live walkthrough.
 *
 * Mostly structural: these are rendering and wording fixes on pages that
 * need a database or a browser to run, so the tests pin the source that
 * decides each behaviour. Each section names the walkthrough item it covers.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const en = () => JSON.parse(read("messages/en.json"));
const ar = () => JSON.parse(read("messages/ar.json"));

describe("B7: the store's cover shows on its public page", () => {
  test("rendered above the header, 3:1, when the store has one", () => {
    const page = read("app/shop/[slug]/page.tsx");
    const cover = page.indexOf("{shop.coverImage && (");
    const header = page.indexOf("{/* Shop header */}");
    assert.ok(cover > 0 && header > cover, "cover first, then the header");
    assert.ok(page.includes("src={shop.coverImage}"));
    assert.ok(page.includes("aspect-[3/1]"));
  });
});

describe("B9: no link goes nowhere", () => {
  test("no href=\"#\" anywhere in pages or components", () => {
    for (const file of ["app/signup/page.tsx", "app/dashboard/shop/[slug]/add-product/page.tsx"]) {
      assert.ok(!read(file).includes('href="#"'), file);
    }
  });

  test("signup's Terms and Privacy open the real pages; the add-product help opens the listing standards", () => {
    const signup = read("app/signup/page.tsx");
    assert.ok(signup.includes('<Link href="/terms"') && signup.includes('<Link href="/privacy"'));
    assert.ok(read("app/dashboard/shop/[slug]/add-product/page.tsx").includes('<Link href="/content-policy#listing-standards"'));
    assert.ok(read("app/content-policy/page.tsx").includes('<section id="listing-standards"'));
    assert.match(en().dashboard.product.add.helpText, /<link>listing standards<\/link>/);
    assert.match(ar().dashboard.product.add.helpText, /<link>معايير قبول المنتج<\/link>/);
  });
});

describe("B10: the create-store address preview is right", () => {
  test("it shows SaiFlow's real domain, from the one shared constant", async () => {
    const page = read("app/dashboard/create-shop/page.tsx");
    assert.ok(page.includes('import { SITE_URL } from "@/lib/site-url";'));
    assert.ok(page.includes("host: SITE_HOST"));
    for (const messages of [en(), ar()]) {
      assert.ok(messages.dashboard.createShop.slugPreview.includes("{host}/shop/{slug}"));
      assert.ok(!messages.dashboard.createShop.slugPreview.includes("saiflow.com"));
    }
    const { SITE_URL } = await import("../lib/site-url.ts");
    assert.equal(new URL(SITE_URL).host, "www.saiflow.io");
  });

  test("the preview uses the server's slug rule, so mixed names lose their stray hyphens", async () => {
    const { slugBase } = await import("../lib/slug.ts");
    assert.equal(slugBase("SaiFlow Test Store (تجريبي)"), "saiflow-test-store");
    assert.equal(slugBase("  -Hello- "), "hello");
    assert.ok(read("app/dashboard/create-shop/page.tsx").includes("slugBase(name).length >= 2"));
  });

  test("no saiflow.com address is left anywhere a user can see", () => {
    for (const file of ["messages/en.json", "messages/ar.json", "app/docs/[slug]/page.tsx", "app/dashboard/create-shop/page.tsx"]) {
      assert.ok(!read(file).includes("saiflow.com"), file);
    }
  });
});

describe("B11: signing out takes one click", () => {
  test("the button waits for the session to end, then reloads the home page, and cannot be clicked twice", () => {
    const button = read("components/auth/SignOutButton.tsx");
    assert.ok(button.includes("await signOut({ redirect: false })"));
    assert.ok(button.includes('window.location.assign("/")'));
    assert.ok(button.includes("disabled={busy}"));
  });

  test("both navbar menus use it; nothing calls signOut with an immediate redirect any more", () => {
    const nav = read("components/Navbar.tsx");
    assert.equal((nav.match(/<SignOutButton/g) ?? []).length, 2);
    assert.ok(!nav.includes("signOut({ callbackUrl"));
    assert.ok(en().nav.signingOut && ar().nav.signingOut);
  });
});

describe("B12: \"checkout is being activated\" appears once on a product page", () => {
  test("the button says it in pre-launch; the page's own line shows only once payments are open, and says something else", () => {
    const page = read("app/shop/[slug]/product/[productSlug]/page.tsx");
    assert.match(page, /\{!preLaunchMode && \(\s*<p className="text-center text-sm text-gray-500 mt-4">\s*\{t\("storefront\.productDetail\.secureCheckout"\)\}/);
    assert.ok(read("app/shop/[slug]/product/[productSlug]/BuyButton.tsx").includes('t("preLaunch.checkoutDisabled")'));
    assert.equal(en().storefront.productDetail.secureCheckout, "Secure checkout.");
    assert.notEqual(ar().storefront.productDetail.secureCheckout, ar().preLaunch.checkoutDisabled);
  });
});

describe("B13: the footer's Start selling goes where the others do", () => {
  test("signup when signed out, the dashboard when signed in", () => {
    const footer = read("components/Footer.tsx");
    assert.ok(footer.includes('const startSellingHref = status === "authenticated" ? "/dashboard" : "/signup";'));
    assert.ok(footer.includes("<Link href={startSellingHref} className={linkClass}>{t('nav.startSelling')}</Link>"));
    assert.ok(!footer.includes(`<Link href="/dashboard" className={linkClass}>{t('nav.startSelling')}`));
  });
});

describe("C14: after signing up, a clear check-your-inbox screen", () => {
  test("the form gives way to the address, three plain steps, resend and start-again", () => {
    const page = read("app/signup/page.tsx");
    assert.ok(page.includes("{createdEmail ? ("), "the screen replaces the form");
    assert.ok(page.includes('<p className="mt-1 font-medium text-white break-all" dir="ltr">{createdEmail}</p>'));
    for (const key of ["inbox.title", "inbox.sentTo", "inbox.step1", "inbox.step2", "inbox.step3", "inbox.differentEmail", "resendButton", "successEmailFailed"]) {
      assert.ok(page.includes(`t('auth.signup.${key}')`), key);
    }
    assert.ok(page.includes("<ResendVerification email={createdEmail}"));
  });

  test("the password step is explained in plain words, in both languages", () => {
    for (const messages of [en(), ar()]) {
      const inbox = messages.auth.signup.inbox;
      for (const key of ["title", "sentTo", "step1", "step2", "step3", "differentEmail"]) assert.ok(inbox[key], key);
    }
    assert.match(en().auth.signup.inbox.step3, /type the password you just chose/);
    assert.match(ar().auth.signup.inbox.step3, /اكتب كلمة المرور التي اخترتها/);
  });
});

describe("C15: upload buttons speak the page's language and list types cleanly", () => {
  test("the list comes from the enforced configs, grouped by size", async () => {
    const { allowedGroups } = await import("../lib/upload-labels.ts");
    assert.deepEqual(allowedGroups("productThumbnail"), [{ labels: ["JPG", "PNG", "WEBP", "GIF", "HEIC", "HEIF", "AVIF"], maxSize: "16 MB" }]);
    assert.deepEqual(allowedGroups("shopLogo"), [{ labels: ["JPG", "PNG", "WEBP", "GIF", "HEIC", "HEIF", "AVIF"], maxSize: "4 MB" }]);
    assert.deepEqual(allowedGroups("shopCover")[0].maxSize, "8 MB");
    const file = allowedGroups("productFile");
    assert.deepEqual(file.find((g) => g.maxSize === "32 MB")!.labels.slice(0, 2), ["PDF", "EPUB"]);
    assert.deepEqual(file.find((g) => g.maxSize === "128 MB")!.labels, ["ZIP", "audio", "video"]);
    for (const group of [...file, ...allowedGroups("productThumbnail")]) {
      for (const label of group.labels) assert.ok(!label.includes("/"), `no MIME type shown: ${label}`);
    }
  });

  test("all six upload buttons use the translated words", () => {
    for (const [file, count] of [
      ["app/dashboard/shop/[slug]/add-product/page.tsx", 2],
      ["app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx", 2],
      ["app/dashboard/shop/[slug]/edit/page.tsx", 2],
    ] as const) {
      const src = read(file);
      assert.equal((src.match(/<UploadButton/g) ?? []).length, count, file);
      assert.equal((src.match(/content=\{\w+UploadContent\}/g) ?? []).length, count, file);
    }
    for (const messages of [en(), ar()]) {
      for (const key of ["choose", "loading", "uploading", "allowed", "separator", "audio", "video"]) assert.ok(messages.upload[key], key);
    }
    assert.equal(ar().upload.choose, "اختر ملفًا");
  });
});

describe("C16: screen readers can name every remove button and product picture", () => {
  test("each remove-image and remove-file button has a label, in both languages", () => {
    const pages: Array<[string, string[]]> = [
      ["app/dashboard/shop/[slug]/add-product/page.tsx", ['aria-label={t("upload.removeImage")}', 'aria-label={t("upload.removeFile")}']],
      ["app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx", ['aria-label={t("upload.removeImage")}', 'aria-label={t("upload.removeFile")}']],
      ["app/dashboard/shop/[slug]/edit/page.tsx", ['aria-label={tUpload("removeImage")}']],
    ];
    for (const [file, labels] of pages) {
      const src = read(file);
      for (const label of labels) assert.ok(src.includes(label), `${file}: ${label}`);
    }
    assert.equal((read("app/dashboard/shop/[slug]/edit/page.tsx").match(/aria-label=\{tUpload\("removeImage"\)\}/g) ?? []).length, 2, "cover and logo");
    for (const messages of [en(), ar()]) assert.ok(messages.upload.removeImage && messages.upload.removeFile);
  });

  test("product pictures on store cards and the product page are described by the product's name", () => {
    assert.ok(read("app/shop/[slug]/page.tsx").includes("alt={product.name}"));
    assert.equal((read("app/shop/[slug]/product/[productSlug]/page.tsx").match(/alt=\{product\.name\}/g) ?? []).length, 2);
  });
});

describe("C17: the language switcher is labelled in the page's own language", () => {
  test("its spoken label is translated; its visible name is the target language's own", () => {
    const sw = read("components/LanguageSwitcher.tsx");
    assert.ok(!sw.includes('aria-label="Switch language"'));
    assert.ok(sw.includes("aria-label={next === 'en' ? t('switchToEnglish') : t('switchToArabic')}"));
    assert.ok(sw.includes("<span lang={next}"));
    assert.match(ar().nav.switchToEnglish, /التبديل إلى الإنجليزية/);
    assert.match(en().nav.switchToArabic, /Switch to Arabic/);
  });
});

describe("C18: seller-written text keeps its punctuation where it was typed", () => {
  test("store and product descriptions set their direction per line", () => {
    const product = read("app/shop/[slug]/product/[productSlug]/page.tsx");
    const store = read("app/shop/[slug]/page.tsx");
    assert.match(product, /<p dir="auto" className="[^"]*\[unicode-bidi:plaintext\][^"]*">\s*\{product\.description/);
    assert.match(store, /<p dir="auto" className="[^"]*\[unicode-bidi:plaintext\][^"]*">\s*\{shop\.description\}/);
    assert.match(store, /<p dir="auto" className="[^"]*\[unicode-bidi:plaintext\][^"]*">\s*\{product\.description\}/);
  });
});

describe("C19: no purchase promises while checkout is off", () => {
  test("in pre-launch the included list says it applies once payments open, and the secure-payment line is hidden", () => {
    const page = read("app/shop/[slug]/product/[productSlug]/page.tsx");
    assert.match(page, /\{preLaunchMode && \(\s*<p[^>]*>\{t\("storefront\.productDetail\.includedOncePaymentsOpen"\)\}/);
    assert.match(page, /\{!preLaunchMode && \([\s\S]{0,700}paymentsProcessedSecurely/);
    assert.ok(en().storefront.productDetail.includedOncePaymentsOpen && ar().storefront.productDetail.includedOncePaymentsOpen);
  });
});

describe("C20: dashboards show their shape while loading, not a blank screen", () => {
  const pages = [
    "app/dashboard/page.tsx",
    "app/dashboard/sales/page.tsx",
    "app/dashboard/shop/[slug]/page.tsx",
    "app/dashboard/shop/[slug]/edit/page.tsx",
    "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
    "app/dashboard/shop/[slug]/payouts/page.tsx",
  ];

  test("every client-fetched dashboard page renders a skeleton while it waits", () => {
    for (const file of pages) {
      const src = read(file);
      assert.ok(src.includes("<DashboardSkeleton label="), file);
      assert.ok(!src.includes("animate-spin rounded-full h-10 w-10"), `${file}: the full-screen spinner is gone`);
    }
  });

  test("server-rendered dashboard pages have a route-level skeleton too, and it announces itself", () => {
    assert.ok(read("app/dashboard/loading.tsx").includes("<DashboardSkeleton"));
    const skeleton = read("components/ui/DashboardSkeleton.tsx");
    assert.ok(skeleton.includes('role="status"') && skeleton.includes('<span className="sr-only">{label}</span>'));
  });
});

describe("Part 2, item 3: the homepage Sell and Buy buttons line up", () => {
  test("equal-height cards, growing text, and buttons of the same size", () => {
    const src = read("components/home/TwoPaths.tsx");
    assert.ok(src.includes('className="grid items-stretch gap-5 md:grid-cols-2"'));
    assert.equal((src.match(/<p className="mt-3 flex-1 /g) ?? []).length, 2, "both texts grow, pushing the buttons down");
    assert.equal((src.match(/mt-7 [^"]*min-h-12/g) ?? []).length, 2, "both buttons share a minimum height");
    assert.match(src, /btn-primary mt-7 min-h-12 w-fit border border-transparent/);
    assert.match(src, /px-6 py-3/);
  });
});

describe("Fixes from the test-site checks on PR #58", () => {
  test("1. upload buttons are ready on load: the dashboard hands them their settings", () => {
    const layout = read("app/dashboard/layout.tsx");
    assert.ok(layout.includes('import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";'));
    assert.ok(layout.includes("<NextSSRPlugin routerConfig={extractRouterConfig(ourFileRouter)} />"));
  });

  test("2. the preview-image help names no type or size of its own; the button's list is the one source", () => {
    for (const messages of [en(), ar()]) {
      for (const help of [messages.dashboard.product.thumbnailHelp, messages.dashboard.product.edit.thumbnailHelp]) {
        assert.ok(!/MB|PNG|JPG/.test(help), help);
      }
    }
  });

  test("3. a just-uploaded cover, logo or thumbnail is previewed straight from storage", () => {
    const shopEdit = read("app/dashboard/shop/[slug]/edit/page.tsx");
    assert.equal((shopEdit.match(/src=\{(coverImage|logo)\}\n[^\n]*\/\/[^\n]*\n[^\n]*\n[^\n]*\n\s*unoptimized/g) ?? []).length, 2);
    for (const file of ["app/dashboard/shop/[slug]/add-product/page.tsx", "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx"]) {
      assert.match(read(file), /src=\{thumbnailUrl\}\n[\s\S]{0,400}?unoptimized/, file);
    }
  });

  test("4. the closing section's two buttons are the same height", () => {
    assert.ok(read("components/home/FinalCta.tsx").includes('className="btn-primary mt-7 border border-transparent text-base"'));
    assert.match(read("app/globals.css"), /\.btn-secondary \{[\s\S]*?border: 1px solid/);
  });

  test("5. the newsletter field has its own name and label; Terms and Privacy name themselves", () => {
    const footer = read("components/Footer.tsx");
    assert.ok(footer.includes('name="newsletter-email"') && !footer.includes('name="email"'));
    assert.ok(footer.includes("aria-label={t('footer.newsletterEmailAria')}"));
    assert.ok(read("app/terms/page.tsx").includes('title: "Terms of Service | SaiFlow"'));
    assert.ok(read("app/privacy/page.tsx").includes('title: "Privacy Policy | SaiFlow"'));
  });
});
