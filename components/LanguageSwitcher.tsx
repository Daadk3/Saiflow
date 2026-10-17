'use client';
import { useLocale, useTranslations } from 'next-intl';

const LOCALE_COOKIE = 'NEXT_LOCALE';
const ONE_YEAR = 60 * 60 * 24 * 365;

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations('nav');
  const next = locale.startsWith('ar') ? 'en' : 'ar';

  const switchTo = (lang: string) => {
    document.cookie = `${LOCALE_COOKIE}=${lang};path=/;max-age=${ONE_YEAR};samesite=lax`;
    // Full reload so the server re-renders <html lang/dir> and all messages.
    window.location.reload();
  };

  return (
    <button
      onClick={() => switchTo(next)}
      className="px-3 py-1.5 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-full hover:border-gray-400 transition-colors flex items-center gap-1.5"
      // Said in the page's language ("التبديل إلى الإنجليزية" on the Arabic
      // page); the visible name is the target language's own, tagged with
      // its language so a screen reader pronounces it correctly.
      aria-label={next === 'en' ? t('switchToEnglish') : t('switchToArabic')}
      lang={locale.startsWith('ar') ? 'ar' : 'en'}
    >
      <span aria-hidden="true">{locale.startsWith('ar') ? '🇺🇸' : '🇸🇦'}</span>
      <span lang={next} dir={next === 'ar' ? 'rtl' : 'ltr'}>{next === 'en' ? 'English' : 'العربية'}</span>
    </button>
  );
}
