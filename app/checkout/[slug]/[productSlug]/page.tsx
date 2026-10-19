import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { SELLABLE_PRODUCT_WHERE, SELLABLE_SHOP_WHERE } from "@/lib/sellable";
import { checkoutScriptUrl, geideaMode, isGeideaConfigured } from "@/lib/payments/geidea/client";
import { isLiveCheckout } from "@/lib/payments/checkout-mode";
import { FOUNDER_TEST_MAX_SAR, productionAccountHere, withinFounderCap } from "@/lib/payments/live-mode";
import { currentCheckoutAccess } from "@/lib/payments/request-access";
import { canonicalAmount } from "@/lib/payments/geidea/callback";
import { CheckoutSummary } from "@/components/checkout/CheckoutSummary";
import { DropInCheckout } from "@/components/checkout/DropInCheckout";
import { PaymentAssurance } from "@/components/checkout/PaymentAssurance";

/**
 * SaiFlow's checkout page: the product, its price, and Geidea's secure card
 * form embedded beneath them.
 *
 * READ-ONLY. Rendering this page writes nothing and asks Geidea nothing; a
 * payment session is created only when the buyer's own browser, having
 * opened the page, asks the checkout route for one. Prefetches, crawlers and
 * previews start no attempt.
 *
 * THE SAME PRODUCTS THE STOREFRONT SELLS, AND NO OTHERS. The query below is
 * the public product page's rule, clause for clause: an active, approved
 * product in an active shop whose current deliverable passes
 * SAFE_DELIVERABLE_WHERE. Anything else is a 404, exactly as on the product
 * page. The checkout route re-applies every gate on its own before any money
 * moves; this page is not an authority, it only declines to offer what the
 * route would refuse.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checkout");
  return {
    title: t("metaTitle"),
    // A checkout is a step, not a destination.
    robots: { index: false, follow: false },
  };
}

async function getCheckoutProduct(shopSlug: string, productSlug: string) {
  return prisma.product.findFirst({
    where: {
      slug: productSlug,
      // The one storefront rule (lib/sellable), plus this page's shop slug.
      ...SELLABLE_PRODUCT_WHERE,
      shop: { ...SELLABLE_SHOP_WHERE, slug: shopSlug },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      currency: true,
      thumbnailUrl: true,
      shop: { select: { name: true, slug: true } },
    },
  });
}

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}) {
  const { slug, productSlug } = await params;
  const product = await getCheckoutProduct(slug, productSlug);
  if (!product) {
    notFound();
  }

  const t = await getTranslations("checkout");
  const productHref = `/shop/${encodeURIComponent(product.shop.slug)}/product/${encodeURIComponent(product.slug)}`;
  // Geidea's library, from configuration alone: no request, no session. The
  // page loads it before asking for a session, so a library that will not
  // load can still hand over to the hosted page while nothing is payable.
  let scriptUrl: string | null = null;
  if (isGeideaConfigured()) {
    try {
      scriptUrl = checkoutScriptUrl();
    } catch {
      scriptUrl = null;
    }
  }

  // The same decision the checkout route makes (lib/payments/request-access):
  // the form is offered to the public when pre-launch is off, and otherwise
  // only to a signed-in founder on FOUNDER_TEST_EMAILS. The route re-decides
  // on every request; this page only declines to offer what it would refuse.
  const { access } = await currentCheckoutAccess();
  const founderTest = access.kind === "founder_test";
  // The route never charges on a test account on the live site (it would
  // sell real files for test cards), so the form is not offered there either.
  const testAccountOnLiveSite = geideaMode() === "test" && productionAccountHere(process.env.VERCEL_ENV);
  const formOffered = access.kind !== "closed" && !testAccountOnLiveSite;
  const live = isLiveCheckout(isGeideaConfigured(), geideaMode());
  // A founder test charges a real card, so only small prices (the route refuses the rest).
  const overFounderCap = founderTest && !withinFounderCap(canonicalAmount(product.price) ?? "");

  // Unless Geidea is live, nothing entered here is really charged: say so
  // above everything. Not shown while the form is not offered, where the card
  // form is replaced by the "not available yet" notice.
  const testMode = formOffered && !live;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Link
          href={productHref}
          className="inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-teal-400"
        >
          <svg className="h-4 w-4 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0 7-7m-7 7h18" />
          </svg>
          {t("backToProduct")}
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-white sm:text-3xl">{t("title")}</h1>

        {founderTest && (
          <div role="note" className="mt-4 rounded-xl border border-fuchsia-400/40 bg-fuchsia-400/10 px-4 py-3">
            <p className="text-sm font-semibold text-fuchsia-200">{t("founderTestTitle")}</p>
            <p className="mt-0.5 text-sm text-fuchsia-100/80">
              {live ? t("founderTestBodyLive", { max: FOUNDER_TEST_MAX_SAR }) : t("founderTestBodyTest")}
            </p>
          </div>
        )}

        {testMode && (
          <div role="note" className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3">
            <p className="text-sm font-semibold text-amber-200">{t("testModeTitle")}</p>
            <p className="mt-0.5 text-sm text-amber-100/80">{t("testModeBody")}</p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-8 lg:mt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
          <CheckoutSummary
            name={product.name}
            storeName={product.shop.name}
            thumbnailUrl={product.thumbnailUrl}
            price={Number(product.price)}
            currency={product.currency}
          />

          <section aria-labelledby="checkout-pay-by-card" className="min-w-0">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-gray-800" aria-hidden="true" />
              <h2 id="checkout-pay-by-card" className="text-sm font-medium text-gray-400">
                {t("payByCard")}
              </h2>
              <span className="h-px flex-1 bg-gray-800" aria-hidden="true" />
            </div>

            {!formOffered ? (
              <div role="status" className="rounded-2xl border border-gray-800 bg-[#111111] p-6 text-center">
                <h3 className="text-base font-semibold text-white">{t("payments_offTitle")}</h3>
                <p className="mt-1.5 text-sm text-gray-400">{t("payments_offBody")}</p>
              </div>
            ) : overFounderCap ? (
              <div role="status" className="rounded-2xl border border-fuchsia-400/30 bg-[#111111] p-6 text-center">
                <h3 className="text-base font-semibold text-white">{t("founderTestAmountTitle")}</h3>
                <p className="mt-1.5 text-sm text-gray-400">{t("founderTestAmountBody", { max: FOUNDER_TEST_MAX_SAR })}</p>
              </div>
            ) : (
              <DropInCheckout productId={product.id} productHref={productHref} scriptUrl={scriptUrl} />
            )}

            <PaymentAssurance />
          </section>
        </div>
      </main>
    </div>
  );
}
