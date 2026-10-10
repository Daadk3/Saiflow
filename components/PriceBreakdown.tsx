"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatPrice } from "@/lib/formatPrice";
import { commissionPercentLabel, halalasToNumber, priceBreakdown } from "@/lib/pricing";

/**
 * The seller's live split of a price, straight from lib/pricing: what the
 * buyer pays, SaiFlow's commission, what the seller keeps. Updates as they
 * type. No processor fee appears here: SaiFlow absorbs it.
 */
export function PriceBreakdown({ price, currency = "SAR" }: { price: string; currency?: string }) {
  const t = useTranslations("dashboard.product.breakdown");
  const locale = useLocale();
  const split = priceBreakdown(price);
  const money = (halalas: number) => <bdi>{formatPrice(halalasToNumber(halalas), currency, locale)}</bdi>;

  return (
    <div
      aria-live="polite"
      data-testid="price-breakdown"
      className="mt-3 rounded-xl border border-gray-800 bg-[#0a0a0a] px-4 py-3 text-sm"
    >
      {split ? (
        <dl className="space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-400">{t("salePrice")}</dt>
            <dd className="tabular-nums text-gray-200">{money(split.grossHalalas)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-400">{t("commission", { rate: commissionPercentLabel() })}</dt>
            <dd className="tabular-nums text-gray-200">{money(split.commissionHalalas)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-gray-800 pt-1.5">
            <dt className="font-medium text-white">{t("earnings")}</dt>
            <dd className="tabular-nums font-semibold text-teal-400">{money(split.sellerNetHalalas)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-xs text-gray-500">{t("hint")}</p>
      )}
    </div>
  );
}
