"use client";

import Link from "next/link";
import Image from "next/image";
import { useLanguage } from "@/contexts/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();
  const linkClass =
    "text-gray-400 hover:text-white text-sm font-medium transition-colors";

  return (
    <footer role="contentinfo" aria-label="Site footer" className="bg-[#0a0a0a] border-t border-gray-800 py-16 px-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top grid */}
        <div className="grid gap-12 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-4">
            <Link href="/" className="logo flex items-center gap-2">
              <Image src="/mascot.png" alt="" aria-hidden="true" width={40} height={40} />
              <span className="text-xl font-semibold text-white">Saiflow</span>
            </Link>
            <p className="text-gray-400 text-sm leading-relaxed">
              {t('footer.tagline')}
            </p>

            {/* Newsletter */}
            <div className="newsletter-section space-y-3">
              <h3 className="text-sm font-semibold text-white">Stay in the loop</h3>
              <form className="flex flex-col sm:flex-row gap-3">
                <label htmlFor="newsletter-email" className="sr-only">
                  Email address for newsletter
                </label>
                <input
                  id="newsletter-email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  aria-label="Email address for newsletter"
                  className="w-full rounded-lg border border-gray-800 bg-[#0a0a0a] px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <button 
                  type="submit"
                  className="inline-flex justify-center rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-600"
                >
                  Subscribe
                </button>
              </form>
              <p className="text-xs text-gray-500">Get product updates and creator tips.</p>
            </div>
          </div>

          {/* Columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 lg:col-span-3">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Product</h3>
              <ul className="flex flex-col gap-2">
                <li><Link href="/browse" className={linkClass}>{t('products.allProducts')}</Link></li>
                <li><Link href="/features" className={linkClass}>{t('nav.features')}</Link></li>
                <li><Link href="/pricing" className={linkClass}>{t('nav.pricing')}</Link></li>
                <li><Link href="/dashboard" className={linkClass}>{t('nav.startSelling')}</Link></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Company</h3>
              <ul className="flex flex-col gap-2">
                <li><Link href="/about" className={linkClass}>{t('footer.about')}</Link></li>
                <li><Link href="/blog" className={linkClass}>{t('footer.blog')}</Link></li>
                <li><Link href="/contact" className={linkClass}>{t('footer.contact')}</Link></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Resources</h3>
              <ul className="flex flex-col gap-2">
                <li><Link href="/docs" className={linkClass}>{t('footer.docs')}</Link></li>
                <li><Link href="/blog" className={linkClass}>{t('footer.blog')}</Link></li>
                <li><Link href="/support" className={linkClass}>{t('common.support')}</Link></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Legal</h3>
              <ul className="flex flex-col gap-2">
                <li><Link href="/terms" className={linkClass}>{t('footer.terms')}</Link></li>
                <li><Link href="/privacy" className={linkClass}>{t('footer.privacy')}</Link></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-between gap-6 border-t border-gray-800 pt-6">
          <p className="text-sm text-gray-500">
            {t('footer.copyright')}
          </p>
          <div className="flex items-center gap-4 text-gray-500">
            <Link href="https://twitter.com" aria-label="Twitter" className="hover:text-white transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.46 6c-.77.35-1.6.58-2.46.69a4.26 4.26 0 001.88-2.35 8.36 8.36 0 01-2.69 1.03 4.21 4.21 0 00-7.3 3.84A11.95 11.95 0 013 4.79a4.2 4.2 0 001.3 5.62 4.16 4.16 0 01-1.9-.53v.05a4.21 4.21 0 003.38 4.12 4.23 4.23 0 01-1.9.07 4.22 4.22 0 003.93 2.92A8.45 8.45 0 012 19.54 11.93 11.93 0 008.29 21c7.55 0 11.68-6.26 11.68-11.68 0-.18 0-.35-.01-.53A8.35 8.35 0 0022.46 6z" />
              </svg>
            </Link>
            <Link href="https://facebook.com" aria-label="Facebook" className="hover:text-white transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 10.5V8.75c0-.83.17-1.25 1.36-1.25H15V5h-1.64C10.86 5 10 6.34 10 8.52v2H8v2.5h2V20h3v-7h2.09L15.5 10.5H13z" />
              </svg>
            </Link>
            <Link href="https://instagram.com" aria-label="Instagram" className="hover:text-white transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 3h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7a4 4 0 014-4zm0 2a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H7zm11.25 1.25a1.25 1.25 0 11-2.5 0 1.25 1.25 0 012.5 0zM12 8a4 4 0 110 8 4 4 0 010-8zm0 2a2 2 0 100 4 2 2 0 000-4z" />
              </svg>
            </Link>
            <Link href="https://linkedin.com" aria-label="LinkedIn" className="hover:text-white transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.94 20H3.72V9h3.22v11zM5.33 7.53a1.87 1.87 0 110-3.74 1.87 1.87 0 010 3.74zM20.28 20h-3.22v-5.7c0-1.36-.03-3.1-1.9-3.1-1.9 0-2.19 1.48-2.19 3v5.8h-3.22V9h3.09v1.5h.04c.43-.82 1.48-1.68 3.04-1.68 3.26 0 3.86 2.15 3.86 4.95V20z" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

