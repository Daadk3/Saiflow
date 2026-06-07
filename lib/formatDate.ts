const SAUDI_LOCALE_MAP: Record<string, string> = {
  ar: "ar-SA",
  en: "en-SA",
  "ar-SA": "ar-SA",
  "en-SA": "en-SA",
};

export function formatDate(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const intlLocale = SAUDI_LOCALE_MAP[locale] ?? "en-SA";
  return new Intl.DateTimeFormat(intlLocale, {
    calendar: "gregory",
    ...(options ?? {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
  }).format(d);
}
