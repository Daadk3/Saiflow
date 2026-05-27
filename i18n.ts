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

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
