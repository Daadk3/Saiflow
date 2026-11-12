"use client";

import { useTranslations } from "next-intl";
import { validatePrice } from "@/lib/pricing";
import {
  LANDING_LIMITS,
  type ListingFormValue,
  type ProductFaq,
} from "@/lib/product-landing";

const fieldClass =
  "w-full px-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors";

/**
 * Optional compare-at price and long-form page. Every field can stay blank.
 * The server (lib/product-landing) is the check; these limits only stop the
 * seller typing past what that check will accept.
 */
export function ProductListingFields({
  price,
  value,
  onChange,
}: {
  price: string;
  value: ListingFormValue;
  onChange: (next: ListingFormValue) => void;
}) {
  const t = useTranslations("dashboard.product");
  const selling = validatePrice(price);
  const compareText = value.compareAtPrice.trim();
  const compare = compareText === "" ? null : validatePrice(compareText);
  const notHigher = Boolean(selling.ok && compare?.ok && compare.halalas <= selling.halalas);

  function patch(partial: Partial<ListingFormValue>) {
    onChange({ ...value, ...partial });
  }

  function patchFaq(index: number, partial: Partial<ProductFaq>) {
    patch({
      faq: value.faq.map((item, i) => (i === index ? { ...item, ...partial } : item)),
    });
  }

  return (
    <fieldset className="space-y-5 rounded-2xl border border-gray-800 p-4 sm:p-5">
      <legend className="px-1 text-sm font-medium text-gray-300">{t("landingHeading")}</legend>
      <p className="text-xs leading-relaxed text-gray-500">{t("landingHelp")}</p>

      <div>
        <label htmlFor="compareAtPrice" className="mb-2 block text-sm font-medium text-gray-300">
          {t("compareAtLabel")}
        </label>
        <div className="relative">
          <span className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-500">{t("currencySymbol")}</span>
          <input
            id="compareAtPrice"
            type="number"
            inputMode="decimal"
            dir="ltr"
            step="0.01"
            min="0"
            value={value.compareAtPrice}
            onChange={(e) => patch({ compareAtPrice: e.target.value })}
            onWheel={(e) => e.currentTarget.blur()}
            placeholder="149.00"
            autoComplete="off"
            className={`no-spinner ps-14 pe-4 ${fieldClass}`}
          />
        </div>
        <p className="mt-1 text-xs text-gray-500">{t("compareAtHelp")}</p>
        {notHigher && <p className="mt-1 text-xs text-amber-300">{t("compareAtNotHigher")}</p>}
      </div>

      <div>
        <label htmlFor="audience" className="mb-2 block text-sm font-medium text-gray-300">
          {t("audienceLabel")}
        </label>
        <textarea
          id="audience"
          value={value.audience}
          onChange={(e) => patch({ audience: e.target.value })}
          rows={2}
          maxLength={LANDING_LIMITS.audience}
          placeholder={t("audiencePlaceholder")}
          className={`${fieldClass} resize-none`}
        />
      </div>

      <div>
        <label htmlFor="benefits" className="mb-2 block text-sm font-medium text-gray-300">
          {t("benefitsLabel")}
        </label>
        <textarea
          id="benefits"
          value={value.benefits}
          onChange={(e) => patch({ benefits: e.target.value })}
          rows={4}
          placeholder={t("benefitsPlaceholder")}
          className={`${fieldClass} resize-y`}
        />
        <p className="mt-1 text-xs text-gray-500">{t("lineListHelp", { max: LANDING_LIMITS.benefits.max })}</p>
      </div>

      <div>
        <label htmlFor="included" className="mb-2 block text-sm font-medium text-gray-300">
          {t("includedLabel")}
        </label>
        <textarea
          id="included"
          value={value.included}
          onChange={(e) => patch({ included: e.target.value })}
          rows={4}
          placeholder={t("includedPlaceholder")}
          className={`${fieldClass} resize-y`}
        />
        <p className="mt-1 text-xs text-gray-500">{t("lineListHelp", { max: LANDING_LIMITS.included.max })}</p>
      </div>

      <div>
        <label htmlFor="guarantee" className="mb-2 block text-sm font-medium text-gray-300">
          {t("guaranteeLabel")}
        </label>
        <textarea
          id="guarantee"
          value={value.guarantee}
          onChange={(e) => patch({ guarantee: e.target.value })}
          rows={2}
          maxLength={LANDING_LIMITS.guarantee}
          placeholder={t("guaranteePlaceholder")}
          className={`${fieldClass} resize-none`}
        />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-gray-300">{t("faqLabel")}</p>
        <div className="space-y-3">
          {value.faq.map((item, index) => (
            <div key={index} className="space-y-2 rounded-xl border border-gray-800 p-3">
              <input
                value={item.question}
                onChange={(e) => patchFaq(index, { question: e.target.value })}
                maxLength={LANDING_LIMITS.faq.question}
                placeholder={t("faqQuestion")}
                aria-label={t("faqQuestion")}
                className={fieldClass}
              />
              <textarea
                value={item.answer}
                onChange={(e) => patchFaq(index, { answer: e.target.value })}
                maxLength={LANDING_LIMITS.faq.answer}
                rows={2}
                placeholder={t("faqAnswer")}
                aria-label={t("faqAnswer")}
                className={`${fieldClass} resize-none`}
              />
              <button
                type="button"
                onClick={() => patch({ faq: value.faq.filter((_, i) => i !== index) })}
                className="text-xs text-gray-400 transition-colors hover:text-red-400"
              >
                {t("faqRemove")}
              </button>
            </div>
          ))}
        </div>
        {value.faq.length < LANDING_LIMITS.faq.max && (
          <button
            type="button"
            onClick={() => patch({ faq: [...value.faq, { question: "", answer: "" }] })}
            className="mt-3 text-sm font-medium text-teal-400 transition-colors hover:text-teal-300"
          >
            {t("faqAdd")}
          </button>
        )}
      </div>
    </fieldset>
  );
}
