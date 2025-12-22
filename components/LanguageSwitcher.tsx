'use client';
import { useLanguage } from '@/contexts/LanguageContext';

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <button
      onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
      className="px-3 py-1.5 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-full hover:border-gray-400 transition-colors"
    >
      {language === 'en' ? '🇸🇦 العربية' : '🇺🇸 English'}
    </button>
  );
}
