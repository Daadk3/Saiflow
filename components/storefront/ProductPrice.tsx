import { formatPrice } from "@/lib/formatPrice";
import { publicOffer } from "@/lib/product-landing";

/**
 * The price a buyer pays, and — when the seller set a higher compare-at
 * price — that price struck through with the saving. Display only. The
 * number passed as `price` is the amount checkout charges.
 */
export function ProductPrice({
  price,
  compareAtPrice,
  currency,
  locale,
  saveLabel,
  size = "hero",
}: {
  price: number;
  compareAtPrice: number | null;
  currency: string;
  locale: string;
  /** Already translated, with the percent filled in. Ignored when there is no whole-percent saving. */
  saveLabel: string | null;
  size?: "hero" | "bar";
}) {
  const offer = publicOffer(price, compareAtPrice);
  const hero = size === "hero";

  return (
    <div className={hero ? "flex flex-wrap items-baseline gap-x-3 gap-y-2" : "flex flex-wrap items-baseline gap-x-2 gap-y-1"}>
      {offer && (
        <s className={hero ? "text-lg text-gray-500" : "text-xs text-gray-500"}>
          <bdi>{formatPrice(offer.compareAt, currency, locale)}</bdi>
        </s>
      )}
      {offer?.percent != null && saveLabel && (
        <span
          className={
            hero
              ? "rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-sm font-semibold text-emerald-300"
              : "rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300"
          }
        >
          {saveLabel}
        </span>
      )}
      <span className={hero ? "text-4xl font-bold text-white" : "text-lg font-bold text-white"}>
        <bdi>{formatPrice(price, currency, locale)}</bdi>
      </span>
    </div>
  );
}
