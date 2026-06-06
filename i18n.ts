import {getRequestConfig} from 'next-intl/server';
import {cookies} from 'next/headers';

export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];

// Arabic-first: default to 'ar' until the visitor explicitly switches.
export const defaultLocale: Locale = 'ar';

// Name of the cookie the language switcher writes to.
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const requested = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = locales.includes(requested as Locale)
    ? (requested as Locale)
    : defaultLocale;

  // Saudi region tag so next-intl's internal Intl.NumberFormat (used by the
  // ICU `#` placeholder) renders Arabic-Indic digits in ar mode. The bare
  // `locale` is preserved for the messages import path and the cookie token.
  const intlLocale = locale === 'ar' ? 'ar-SA' : 'en-SA';

  return {
    locale: intlLocale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
