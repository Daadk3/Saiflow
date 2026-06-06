const VALID_ISO_CURRENCY = /^[A-Z]{3}$/;

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

  // Map our app locales to Intl locales:
  //   'ar' → 'ar-SA' (Arabic-Indic numerals + ر.س symbol)
  //   'en' → 'en-SA' (Western numerals, "SAR" prefix, Saudi context)
  // 'en-SA' is the correct choice over 'en-US' because the currency
  // context is Saudi.
  const intlLocale = locale === "ar" ? "ar-SA" : "en-SA";

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
