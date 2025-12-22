'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

export default function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const languages = [
    { code: 'en', name: 'EN', flag: '🇺🇸', fullName: 'English' },
    { code: 'ar', name: 'ع', flag: '🇸🇦', fullName: 'العربية' },
  ];

  const currentLanguage = languages.find((lang) => lang.code === locale) || languages[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const switchLanguage = (newLocale: string) => {
    // Replace the locale in the pathname
    // Handle both /en/... and /ar/... patterns
    const segments = pathname.split('/').filter(Boolean);
    
    // Check if first segment is a locale
    if (segments[0] === 'en' || segments[0] === 'ar') {
      segments[0] = newLocale;
    } else {
      // If no locale in path, add it at the beginning
      segments.unshift(newLocale);
    }
    
    const newPathname = '/' + segments.join('/');
    setIsOpen(false);
    
    // Persist to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('locale', newLocale);
    }
    
    // Navigate to new locale
    router.push(newPathname);
    router.refresh();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-sm text-gray-300 hover:text-white px-2 py-1.5 rounded-md hover:bg-gray-800/50 transition-colors"
        aria-label="Switch language"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="text-base">{currentLanguage.flag}</span>
        <span className="font-medium">{currentLanguage.name}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 rtl:left-0 rtl:right-auto bg-[#111111] border border-gray-800 rounded-lg shadow-lg z-50 min-w-[140px] overflow-hidden">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => switchLanguage(lang.code)}
              className={`w-full flex items-center gap-2 px-4 py-2.5 text-left rtl:text-right hover:bg-gray-800 transition-colors ${
                locale === lang.code ? 'bg-gray-800/50 text-white' : 'text-gray-300'
              }`}
            >
              <span className="text-base">{lang.flag}</span>
              <span className="text-sm font-medium flex-1">{lang.name}</span>
              {locale === lang.code && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-teal-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

