'use client';
import { useLanguage } from '@/contexts/LanguageContext';

export function LanguageSwitcher() {
  try {
    const { language, setLanguage } = useLanguage();

    return (
      <button
        onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
        className="px-3 py-1.5 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-full hover:border-gray-400 transition-colors flex items-center gap-1.5"
        aria-label="Switch language"
      >
        <span>{language === 'en' ? '🇸🇦' : '🇺🇸'}</span>
        <span>{language === 'en' ? 'العربية' : 'English'}</span>
      </button>
    );
  } catch (error) {
    // Fallback if context is not available
    console.warn('LanguageContext not available:', error);
    return (
      <button
        className="px-3 py-1.5 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-full hover:border-gray-400 transition-colors"
        disabled
      >
        EN
      </button>
    );
  }
}
