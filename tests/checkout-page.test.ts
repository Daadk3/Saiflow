/**
 * SaiFlow's checkout page, its components and the Buy button.
 *
 * STRUCTURAL: Node's runner cannot render these, so the guarantees are read
 * from the source. The behaviour behind them is tested elsewhere: the route
 * in geidea-checkout, the client in geidea-dropin-client, the page's own
 * checks in checkout-embedded, and fulfilment, idempotency, the commission
 * snapshot and the sale emails in geidea-callback-route, all unchanged.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Comments explain the traps; they must never satisfy an assertion. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PAGE = "app/checkout/[slug]/[productSlug]/page.tsx";
const PRODUCT_PAGE = "app/shop/[slug]/product/[productSlug]/page.tsx";
const BUY = "app/shop/[slug]/product/[productSlug]/BuyButton.tsx";
const COMPONENTS = [
  "components/checkout/CheckoutSummary.tsx",
  "components/checkout/PaymentAssurance.tsx",
  "components/checkout/DropInPanel.tsx",
  "components/checkout/DropInCheckout.tsx",
];
const ar = JSON.parse(read("messages/ar.json"));
const en = JSON.parse(read("messages/en.json"));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** The `where: { ... }` block of the first findFirst, comments and whitespace removed. */
function whereClause(src: string): string {
  const code = strip(src);
  const start = code.indexOf("where: {", code.indexOf("findFirst("));
  assert.ok(start > 0, "no where clause");
  let depth = 0;
  for (let i = start + "where: ".length; i < code.length; i++) {
    if (code[i] === "{") depth++;
    if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(start, i + 1).replace(/\s+/g, "");
    }
  }
  throw new Error("unbalanced where clause");
}

describe("only what the storefront sells can reach checkout", () => {
  const page = strip(read(PAGE));

  test("the page's product rule is the public product page's rule, clause for clause", () => {
    assert.equal(whereClause(read(PAGE)), whereClause(read(PRODUCT_PAGE)));
    assert.ok(page.includes("...SAFE_DELIVERABLE_WHERE"));
    assert.match(page, /from "@\/lib\/file-safety"/);
    assert.match(page, /moderationStatus: "APPROVED"/);
    assert.match(page, /isActive: true/);
  });

  test("a product outside that rule is a 404, like on the product page", () => {
    assert.match(page, /if \(!product\) \{\s*notFound\(\);\s*\}/);
  });

  test("rendering the page writes nothing and asks Geidea nothing", () => {
    for (const forbidden of ["paymentSession", ".create(", ".update", "createSession", "/api/checkout", "fetch("]) {
      assert.ok(!page.includes(forbidden), `the page must not use ${forbidden}`);
    }
    // Geidea's client module for configuration only: the library URL, derived
    // locally and tested as such in geidea-dropin-client.
    assert.deepEqual(page.match(/import \{[^}]*\} from "@\/lib\/payments\/geidea\/client";/g), [
      'import { checkoutScriptUrl, isGeideaConfigured } from "@/lib/payments/geidea/client";',
    ]);
    assert.match(
      page,
      /let scriptUrl: string \| null = null;\s*if \(isGeideaConfigured\(\)\) \{\s*try \{\s*scriptUrl = checkoutScriptUrl\(\);\s*\} catch \{\s*scriptUrl = null;\s*\}\s*\}/,
      "a configuration it cannot use leaves only the hosted page, never an error page"
    );
    assert.match(page, /<DropInCheckout productId=\{product\.id\} productHref=\{productHref\} scriptUrl=\{scriptUrl\} \/>/);
    assert.match(page, /robots: \{ index: false, follow: false \}/, "checkout is never indexed");
  });

  test("in pre-launch the page explains, and never mounts the payment form", () => {
    assert.match(page, /env\.PRE_LAUNCH_MODE \? \([\s\S]*payments_offTitle[\s\S]*\) : \([\s\S]*<DropInCheckout/);
  });
});

describe("the buyer sees one price", () => {
  test("the summary shows the product, its store, the price and the total, from the same value", () => {
    const summary = strip(read("components/checkout/CheckoutSummary.tsx"));
    assert.match(summary, /const amount = <bdi>\{formatPrice\(price, currency, locale\)\}<\/bdi>;/);
    assert.equal((summary.match(/\{amount\}/g) ?? []).length, 2, "price and total are the same amount");
    for (const key of ["orderSummary", "productPrice", "total"]) assert.ok(summary.includes(`t("${key}")`));
  });

  test("nothing about the seller's share or SaiFlow's commission reaches any checkout surface", () => {
    for (const file of [PAGE, ...COMPONENTS]) {
      const src = strip(read(file));
      assert.ok(!/lib\/pricing|saleBreakdown|priceBreakdown|splitSale|commission|sellerNet|platformFee|عمولة|7%/i.test(src), file);
    }
    const copy = JSON.stringify(ar.checkout) + JSON.stringify(en.checkout);
    assert.ok(!/commission|عمولة|صافي|7%|93%|earnings/i.test(copy));
  });
});

describe("the embedded form is Geidea's, and the browser decides nothing (wiring; behaviour is in checkout-dropin-controller)", () => {
  const dropin = strip(read("components/checkout/DropInCheckout.tsx"));
  const panel = strip(read("components/checkout/DropInPanel.tsx"));
  const controller = strip(read("lib/checkout/dropin-controller.ts"));

  test("every decision is the controller's; the component only connects it to the browser", () => {
    assert.match(dropin, /import \{[\s\S]*createDropInController[\s\S]*\} from "@\/lib\/checkout\/dropin-controller";/);
    for (const decision of ["parseDropInSession", "isHostedCheckoutUrl", "startPayment", "onSuccess", "resumePathFor"]) {
      assert.ok(!dropin.includes(decision), `the component decides ${decision} itself`);
    }
  });

  test("one controller per mounted page, started from a scheduled callback, disposed when the page goes", () => {
    assert.match(
      dropin,
      /useEffect\(\(\) => \{\s*if \(buyerEmail === null\) return;\s*const instance = createDropInController\(productId, buyerEmail, scriptUrl, browserHost\(\), setState\);\s*controller\.current = instance;\s*if \(container\.current !== null\) container\.current\.id = instance\.containerId;\s*const kickoff = window\.setTimeout\(\(\) => \{\s*void instance\.start\(\);\s*\}, 0\);\s*return \(\) => \{\s*window\.clearTimeout\(kickoff\);\s*instance\.dispose\(\);/
    );
    assert.match(dropin, /\}, \[productId, buyerEmail, scriptUrl\]\);/);
    assert.match(dropin, /if \(resumeIfReturning\(productId, browserHost\(\)\)\) return;/, "a returning buyer is never asked for anything");
    assert.match(dropin, /onContinueHosted=\{\(\) => void controller\.current\?\.continueOnHostedPage\(\)\}/);
  });

  test("the browser adapter posts JSON to the given route, navigates by location, and loads only the given script", () => {
    assert.match(dropin, /post: async \(url, body\) => \{\s*const response = await fetch\(url, \{\s*method: "POST",/);
    assert.match(dropin, /navigate: \(url\) => window\.location\.assign\(url\)/);
    assert.match(dropin, /script\.src = url;/);
    assert.match(dropin, /document\.getElementById\(containerId\)\?\.querySelector\("iframe"\)/, "readiness is read from the id it is given");
    assert.match(dropin, /waitForFrame: \(containerId\) => waitForFrame\(containerId, MOUNT_TIMEOUT_MS\)/);
    assert.match(dropin, /window\.crypto\.randomUUID\(\)/);
    assert.match(read("lib/checkout/embedded.ts"), /if \(!isTrustedScriptUrl\(scriptUrl\)\) return null;/);
  });

  test("Geidea's drop-in mounts into this mount's own container, which React never renders into", () => {
    assert.match(controller, /const containerId = dropInContainerId\(`\$\{mounts\}-\$\{host\.nonce\(\)\}`\);/);
    assert.match(controller, /startPayment\(parsed\.sessionId, null, containerId\)/);
    assert.match(controller, /await host\.waitForFrame\(containerId\)/);
    assert.match(panel, /<div ref=\{containerRef\} \/>/, "empty, self-closing, and without a rendered id");
  });

  test("no fixed container id exists anywhere", () => {
    const files = [...walk(resolve(ROOT, "app")), ...walk(resolve(ROOT, "components")), ...walk(resolve(ROOT, "lib"))];
    for (const file of files) {
      const src = strip(readFileSync(file, "utf8"));
      assert.ok(!src.includes("DROPIN_CONTAINER_ID"), `${relative(ROOT, file)} uses a fixed container id`);
      assert.ok(!/id=["'{][^"'}]*saiflow-geidea-dropin/.test(src), `${relative(ROOT, file)} renders a fixed container id`);
    }
  });

  test("the browser never writes a purchase, calls the webhook, or builds a download address", () => {
    for (const src of [dropin, panel, controller]) {
      for (const forbidden of ["/api/webhooks", "/api/download", "prisma", "order.create", "Order", "downloadUrl"]) {
        assert.ok(!src.includes(forbidden), `checkout UI references ${forbidden}`);
      }
    }
  });

  test("the hosted page is offered from one notice only, the one shown before any session was requested", () => {
    assert.equal((panel.match(/onClick=\{onContinueHosted\}/g) ?? []).length, 1);
    const fallbackNotice = panel.slice(panel.indexOf('(state.kind === "fallback" || state.kind === "redirecting") && ('), panel.indexOf('state.kind === "stuck" && ('));
    assert.ok(fallbackNotice.includes("onClick={onContinueHosted}"));
    assert.ok(!fallbackNotice.includes("statusPath"), "nothing exists yet whose status could be checked");
  });

  test("a form that did not appear offers the same session again and its status page, never the hosted page", () => {
    const stuckNotice = panel.slice(panel.indexOf('state.kind === "stuck" && ('), panel.indexOf('state.kind === "cancelled" && ('));
    assert.ok(stuckNotice.includes('onClick={onRetry}') && stuckNotice.includes('t("reloadForm")'));
    assert.ok(stuckNotice.includes("href={state.statusPath}") && stuckNotice.includes('t("checkStatus")'));
    assert.ok(!stuckNotice.includes("onContinueHosted"));
    const readyPrompt = panel.slice(panel.indexOf('{state.kind === "ready" && ('), panel.indexOf('state.kind === "confirming" && ('));
    assert.ok(readyPrompt.includes('onClick={onRetry}') && readyPrompt.includes('t("reloadForm")'), "trouble with a shown form reloads it");
    assert.ok(!readyPrompt.includes("onContinueHosted"));
  });

  test("every retry is a reload, which the server answers with this browser's current attempt", () => {
    assert.match(dropin, /onRetry=\{\(\) => window\.location\.reload\(\)\}/);
    assert.equal((dropin.match(/onRetry=/g) ?? []).length, 1);
  });

  test("an expired session is reported above a form that stays on screen", () => {
    assert.match(panel, /state\.kind === "ready" && state\.expired/);
    assert.match(panel, /const frameVisible = state\.kind === "starting" \|\| state\.kind === "ready";/);
  });

  test("after expiry nothing offers to start again: only the attempt's status page", () => {
    const start = panel.indexOf('{state.kind === "ready" && state.expired && (');
    assert.ok(start >= 0);
    const expired = panel.slice(start, panel.indexOf("</Notice>", start));
    assert.ok(expired.includes("href={state.statusPath}") && expired.includes('t("checkStatus")'));
    assert.ok(!expired.includes("onRetry"), "a reload would only reach the status page");
    assert.ok(!expired.includes("onContinueHosted"));
  });

  test("checkout requests run only under the browser's cross-tab lock: no path runs them without it", () => {
    assert.match(dropin, /import \{ runLocked \} from "@\/lib\/checkout\/tab-lock";/);
    assert.match(dropin, /withLock: \(name, task\) => runLocked\(browserLocks\(\), name, task\),/);
    assert.match(
      dropin,
      /function browserLocks\(\): unknown \{\s*try \{\s*return window\.navigator\.locks;\s*\} catch \{\s*return undefined;\s*\}\s*\}/
    );
    assert.ok(!/\btask\(\)/.test(dropin), "the adapter never calls the task itself");
    assert.ok(!dropin.includes(".request("), "the lock is asked for in one place, lib/checkout/tab-lock");
  });
});

describe("SaiFlow never handles card data", () => {
  test("no card field, card identifier or payment-field autocomplete exists anywhere in app, components or lib", () => {
    const files = [...walk(resolve(ROOT, "app")), ...walk(resolve(ROOT, "components")), ...walk(resolve(ROOT, "lib"))];
    const patterns = [
      /autoComplete=["']cc-/i,
      /autocomplete=["']cc-/i,
      /\bcard[_-]?number\b/i,
      /\bcardholder\b/i,
      /\bcvv2?\b/i,
      /\bcvc\b/i,
      /\bsecurity[_-]?code\b/i,
      /\bexpiry[_-]?(month|year)\b/i,
      /name=["'](pan|card|cvv|cvc|expiry)/i,
    ];
    for (const file of files) {
      const src = strip(readFileSync(file, "utf8"));
      for (const pattern of patterns) {
        assert.ok(!pattern.test(src), `${relative(ROOT, file)} matches ${pattern}`);
      }
    }
  });

  test("the checkout UI's only input is the buyer's email, for the receipt", () => {
    for (const file of COMPONENTS) {
      const src = read(file);
      assert.ok(!/<select\b|<textarea\b/.test(src), file);
      if (file === "components/checkout/DropInCheckout.tsx") continue;
      assert.ok(!/<input\b|<form\b/.test(src), file);
    }
    const dropin = read("components/checkout/DropInCheckout.tsx");
    assert.equal((dropin.match(/<input\b/g) ?? []).length, 1, "one field");
    assert.equal((dropin.match(/<form\b/g) ?? []).length, 1, "one form");
    assert.match(dropin, /type="email"/);
    assert.match(dropin, /autoComplete="email"/);
    assert.match(dropin, /const email = normalizeBuyerEmail\(draft\);/, "checked with the server's own rule");
  });

  test("no Geidea host is written anywhere; the library URL always comes from configuration", () => {
    const files = [...walk(resolve(ROOT, "app")), ...walk(resolve(ROOT, "components")), ...walk(resolve(ROOT, "lib"))];
    for (const file of files) {
      const src = strip(readFileSync(file, "utf8"));
      assert.ok(!/geidea\.(net|ae)|ksamerchant/i.test(src), `${relative(ROOT, file)} names a Geidea host`);
    }
  });
});

describe("this phase shows proven card methods only", () => {
  test("mada, Visa and Mastercard, and nothing else", () => {
    const assurance = read("components/checkout/PaymentAssurance.tsx");
    assert.match(assurance, /export const PROVEN_CARD_METHODS = \["mada", "Visa", "Mastercard"\] as const;/);
  });

  test("no wallet, instalment or other method is shown, named or prepared", () => {
    const sources = [PAGE, ...COMPONENTS, "lib/checkout/embedded.ts", "lib/checkout/dropin-controller.ts"].map((f) => strip(read(f)));
    const copy = JSON.stringify(ar.checkout) + JSON.stringify(en.checkout);
    for (const text of [...sources, copy]) {
      assert.ok(!/apple\s?pay|google\s?pay|samsung|stc\s?pay|tabby|tamara|wallet|expressCheckout|GeideaExpressCheckout/i.test(text));
    }
    assert.ok(!existsSync(resolve(ROOT, "public/.well-known")), "no Apple domain file in this phase");
  });
});

describe("the Buy button opens SaiFlow's checkout page", () => {
  const btn = strip(read(BUY));
  const productPage = strip(read(PRODUCT_PAGE));

  test("it navigates, and no longer creates a payment session itself", () => {
    assert.match(btn, /router\.push\(checkoutHref\);/);
    assert.ok(!btn.includes("fetch("), "no request from the product page");
    assert.ok(!btn.includes("/api/checkout"));
    assert.ok(!btn.includes("window.location"));
  });

  test("the product page builds the path with the shared helper, for both buttons", () => {
    assert.match(productPage, /const checkoutHref = checkoutPath\(product\.shop\.slug, product\.slug\);/);
    assert.equal((productPage.match(/<BuyButton checkoutHref=\{checkoutHref\} sellable preLaunchMode=\{preLaunchMode\} \/>/g) ?? []).length, 2);
  });
});

describe("the checkout copy", () => {
  test("both locales define the same keys, none empty, and Arabic is Arabic", () => {
    assert.deepEqual(Object.keys(ar.checkout).sort(), Object.keys(en.checkout).sort());
    for (const loc of [ar, en]) {
      for (const [key, value] of Object.entries(loc.checkout)) assert.ok(String(value).trim().length > 0, key);
    }
    for (const key of ["title", "payByCard", "secure", "instantDelivery", "continueHosted", "backToProduct"]) {
      assert.match(ar.checkout[key], /[؀-ۿ]/, `ar.checkout.${key}`);
    }
    assert.equal(ar.checkout.continueHosted, "متابعة إلى صفحة الدفع الآمنة");
    assert.equal(ar.checkout.payByCard, "ادفع بالبطاقة");
    assert.equal(ar.checkout.secure, "دفع آمن");
    assert.equal(ar.checkout.instantDelivery, "تسليم رقمي مباشرة بعد تأكيد الدفع");
    assert.equal(ar.checkout.checkStatus, "تحقق من حالة الدفع");
    assert.equal(en.checkout.checkStatus, "Check payment status");
  });

  test("every state the panel can show has its words", () => {
    for (const problem of ["rate_limited", "not_available", "payments_off", "cookies", "lock_unavailable", "service"]) {
      for (const suffix of ["Title", "Body"]) assert.ok(en.checkout[`${problem}${suffix}`], `${problem}${suffix}`);
    }
    const panel = read("components/checkout/DropInPanel.tsx");
    for (const key of ["preparing", "confirming", "fallbackTitle", "stuckTitle", "stuckBody", "reloadForm", "cancelledTitle", "declinedTitle", "expiredTitle", "checkStatus", "tryAgain"]) {
      assert.ok(panel.includes(`t("${key}")`), key);
    }
  });

  test("no copy asserts a final failure on the strength of a browser callback", () => {
    for (const key of ["cancelledTitle", "cancelledBody", "declinedTitle", "declinedBody", "stuckTitle", "stuckBody"]) {
      for (const text of [ar.checkout[key], en.checkout[key]]) {
        assert.ok(!/wasn't completed|couldn't be completed|was not completed|\bfailed\b|لم تكتمل|تعذّر إتمام|فشل/i.test(text), text);
      }
    }
    const panel = read("components/checkout/DropInPanel.tsx");
    const cancelled = panel.slice(panel.indexOf('state.kind === "cancelled" && ('), panel.indexOf('state.kind === "declined" && ('));
    assert.ok(cancelled.includes('href={state.statusPath}') && cancelled.includes('t("checkStatus")'), "the cancelled state offers the status page");
  });

  test("no copy promises a new payment after expiry, on the checkout page or the status page", () => {
    assert.ok(!("startAgain" in en.checkout) && !("startAgain" in ar.checkout));
    const texts = [en.checkout.expiredBody, ar.checkout.expiredBody, en.success.expiredBody, ar.success.expiredBody];
    for (const text of texts) {
      assert.ok(!/new payment can start|start a new checkout|يمكن بدء دفعة جديدة|ابدأ عملية شراء جديدة/i.test(text), text);
      assert.match(text, /support|الدعم/, "it says how to pay again: through support");
    }
    for (const key of ["failedBody", "cancelledBody"]) {
      for (const loc of [en, ar]) assert.match(loc.success[key], /support|الدعم/, `${key}: a way out if checkout sends the buyer back`);
    }
  });

  test("a browser that will not keep the checkout cookie is told so, in both languages", () => {
    assert.match(en.checkout.cookiesTitle, /cookies/i);
    assert.match(ar.checkout.cookiesTitle, /[؀-ۿ]/);
    const unavailable = read("components/checkout/DropInPanel.tsx");
    assert.match(unavailable, /\(state\.problem === "service" \|\| state\.problem === "cookies"\) && \(/, "with a way to try again");
  });

  test("a browser that cannot give checkout its lock is told so, with no advice that could start a second payment", () => {
    assert.match(en.checkout.lock_unavailableTitle, /safely/);
    assert.match(ar.checkout.lock_unavailableTitle, /[؀-ۿ]/);
    for (const loc of [en, ar]) {
      const text = `${loc.checkout.lock_unavailableTitle} ${loc.checkout.lock_unavailableBody}`;
      assert.ok(
        !/cookie|clear|another payment|new payment|try again|start again|ملفات تعريف الارتباط|امسح|دفعة أخرى|دفعة جديدة|حاول مرة أخرى|ابدأ من جديد/i.test(text),
        text
      );
    }
    const panel = read("components/checkout/DropInPanel.tsx");
    assert.match(panel, /\(state\.problem === "service" \|\| state\.problem === "cookies"\) && \(/, "and no retry button: a reload meets the same browser");
  });

  test("no copy promises that nothing was charged when that cannot be known", () => {
    for (const key of ["declinedBody", "expiredBody", "stuckBody"]) {
      for (const text of [ar.checkout[key], en.checkout[key]]) {
        assert.ok(!/not charged|no charge|لم يُخصم|لن يُخصم/i.test(text), text);
      }
    }
  });
});
