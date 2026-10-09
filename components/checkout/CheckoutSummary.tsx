import { getLocale, getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/formatPrice";
import { ProductThumbnail } from "@/components/ProductThumbnail";

interface CheckoutSummaryProps {
  name: string;
  storeName: string;
  thumbnailUrl: string | null;
  /** The final price the buyer pays. For display only; the server re-reads it at checkout. */
  price: number;
  currency: string;
}

/**
 * What the buyer is paying for, and how much: the product, its store, the
 * price and the total. Nothing about how that amount is later divided
 * between the seller and SaiFlow belongs here; the buyer pays one price.
 */
export async function CheckoutSummary({ name, storeName, thumbnailUrl, price, currency }: CheckoutSummaryProps) {
  const t = await getTranslations("checkout");
  const locale = await getLocale();
  const amount = <bdi>{formatPrice(price, currency, locale)}</bdi>;

  return (
    <section
      aria-labelledby="checkout-order-summary"
      className="rounded-2xl border border-gray-800 bg-[#111111] p-5 sm:p-6 lg:sticky lg:top-24 lg:self-start"
    >
      <div className="flex items-center gap-4">
        <div className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-gray-800 bg-[#0d0d0d]">
          <ProductThumbnail
            src={thumbnailUrl}
            sizes="96px"
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-teal-500/15 to-cyan-500/10 text-teal-400">
                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
            }
          />
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-base font-semibold leading-snug text-white" title={name}>
            <bdi>{name}</bdi>
          </p>
          <p className="mt-1 truncate text-sm text-gray-400" title={storeName}>
            <bdi>{storeName}</bdi>
          </p>
        </div>
      </div>

      <h2 id="checkout-order-summary" className="mt-6 text-sm font-semibold text-gray-300">
        {t("orderSummary")}
      </h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-gray-400">{t("productPrice")}</dt>
          <dd className="tabular-nums text-gray-200">{amount}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-gray-800 pt-3">
          <dt className="font-semibold text-white">{t("total")}</dt>
          <dd className="text-lg font-bold tabular-nums text-white">{amount}</dd>
        </div>
      </dl>
    </section>
  );
}
