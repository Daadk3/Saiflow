const VALID_ISO_CURRENCY = /^[A-Z]{3}$/;

// Map app locales to Intl locales:
//   'ar' / 'ar-SA' → 'ar-SA' (Arabic-Indic numerals + ر.س symbol)
//   'en' / 'en-SA' → 'en-SA' (Western numerals, "SAR" prefix, Saudi context)
// Identity entries let the helper accept either the bare cookie token or
// the Saudi-tagged form that next-intl now returns from useLocale/getLocale.
const SAUDI_LOCALE_MAP: Record<string, string> = {
  ar: "ar-SA",
  en: "en-SA",
  "ar-SA": "ar-SA",
  "en-SA": "en-SA",
};

export function formatPrice(
  amount: number,
  currency: string | null | undefined,
  locale: string
): string {
  // Defensive: if currency is missing or malformed, fall back to SAR
  // so the page renders rather than throwing. Data issues surface
  // as SAR-labeled prices on USD rows, not as crashes.
  const safeCurrency =
    currency && VALID_ISO_CURRENCY.test(currency) ? currency : "SAR";

  const intlLocale = SAUDI_LOCALE_MAP[locale] ?? "en-SA";

  try {
    return new Intl.NumberFormat(intlLocale, {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Last-resort fallback if even the fallback fails (impossible
    // in practice with a valid locale + SAR, but defensive).
    return `${safeCurrency} ${amount.toFixed(2)}`;
  }
}
