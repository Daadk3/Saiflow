'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function StickyMobileCTA() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show sticky CTA after scrolling 300px
      setIsVisible(window.scrollY > 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden animate-slide-up">
      <div className="bg-gradient-to-t from-gray-900 via-gray-900 to-transparent p-4 pt-8">
        <Link 
          href="/signup"
          className="btn-primary block w-full py-4 px-6 rounded-lg text-center"
          aria-label="Start selling for free - Sign up now"
        >
          Start Selling Free →
        </Link>
      </div>
    </div>
  );
}

