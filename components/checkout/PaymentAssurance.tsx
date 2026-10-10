import { getTranslations } from "next-intl/server";

/**
 * The card brands shown are the ones this checkout has been proven with on
 * Geidea's test environment. Wallets and other methods Geidea documents are
 * not listed until they are enabled for SaiFlow's account and reviewed.
 */
export const PROVEN_CARD_METHODS = ["mada", "Visa", "Mastercard"] as const;

export async function PaymentAssurance() {
  const t = await getTranslations("checkout");
  return (
    <div className="mt-5 space-y-3 text-center">
      <ul className="flex flex-wrap items-center justify-center gap-2" aria-label={t("methodsLabel")} dir="ltr">
        {PROVEN_CARD_METHODS.map((method) => (
          <li
            key={method}
            className="rounded-md border border-gray-800 bg-[#111111] px-2.5 py-1 text-xs font-medium text-gray-300"
          >
            {method}
          </li>
        ))}
      </ul>
      <p className="inline-flex items-center justify-center gap-1.5 text-sm text-gray-300">
        <svg className="h-4 w-4 text-teal-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
        {t("secure")}
      </p>
      <p className="text-xs text-gray-500">{t("instantDelivery")}</p>
    </div>
  );
}
