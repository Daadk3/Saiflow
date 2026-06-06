const SAUDI_LOCALE_MAP: Record<string, string> = {
  ar: "ar-SA",
  en: "en-SA",
  "ar-SA": "ar-SA",
  "en-SA": "en-SA",
};

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions
): string {
  const intlLocale = SAUDI_LOCALE_MAP[locale] ?? "en-SA";
  return new Intl.NumberFormat(intlLocale, options).format(value);
}
