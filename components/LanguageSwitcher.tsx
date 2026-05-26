'use client';
import { useLocale } from 'next-intl';

const LOCALE_COOKIE = 'NEXT_LOCALE';
const ONE_YEAR = 60 * 60 * 24 * 365;

export function LanguageSwitcher() {
  const locale = useLocale();
  const next = locale === 'ar' ? 'en' : 'ar';

  const switchTo = (lang: string) => {
    document.cookie = `${LOCALE_COOKIE}=${lang};path=/;max-age=${ONE_YEAR};samesite=lax`;
    // Full reload so the server re-renders <html lang/dir> and all messages.
    window.location.reload();
  };

  return (
    <button
      onClick={() => switchTo(next)}
      className="px-3 py-1.5 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-full hover:border-gray-400 transition-colors flex items-center gap-1.5"
      aria-label="Switch language"
    >
      <span>{locale === 'ar' ? '🇺🇸' : '🇸🇦'}</span>
      <span>{locale === 'ar' ? 'English' : 'العربية'}</span>
    </button>
  );
}
