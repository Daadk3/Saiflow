"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations();
  const linkClass =
    "text-gray-400 hover:text-white text-sm font-medium transition-colors";

  // Newsletter form is visual-only until /api/newsletter is built.
  // Submit shows a "coming soon" acknowledgment so users get feedback
  // instead of nothing or a spurious page reload.
  // TODO(newsletter-api): wire to mailing list provider + real loading/error states.
  const [email, setEmail] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  function handleNewsletterSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setShowSuccess(true);
    setEmail("");
  }

  return (
    <footer role="contentinfo" aria-label={t('footer.ariaFooter')} className="bg-[#0a0a0a] border-t border-gray-800 py-16 px-4">
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
              <h3 className="text-sm font-semibold text-white">{t('footer.newsletter')}</h3>
              <form className="flex flex-col sm:flex-row gap-3" onSubmit={handleNewsletterSubmit}>
                <label htmlFor="newsletter-email" className="sr-only">
                  {t('footer.newsletterEmailAria')}
                </label>
                <input
                  id="newsletter-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('footer.emailPlaceholder')}
                  aria-label={t('footer.newsletterEmailAria')}
                  className="w-full rounded-lg border border-gray-800 bg-[#0a0a0a] px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <button
                  type="submit"
                  className="inline-flex justify-center rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-600"
                >
                  {t('footer.subscribe')}
                </button>
              </form>
              {showSuccess ? (
                <p className="text-xs text-teal-400" role="status">{t('footer.newsletterComingSoon')}</p>
              ) : (
                <p className="text-xs text-gray-500">{t('footer.newsletterDesc')}</p>
              )}
            </div>
          </div>

          {/* Columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 lg:col-span-3">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">{t('footer.columnProduct')}</h3>
              <ul className="flex flex-col gap-2">
                <li><Link href="/browse" className={linkClass}>{t('products.allProducts')}</Link></li>
                <li><Link href="/features" className={linkClass}>{t('nav.features')}</Link></li>
                <li><Link href="/pricing" className={linkClass}>{t('nav.pricing')}</Link></li>
                <li><Link href="/dashboard" className={linkClass}>{t('nav.startSelling')}</Link></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">{t('footer.columnCompany')}</h3>
              <ul className="flex flex-col gap-2">
                <li><Link href="/about" className={linkClass}>{t('footer.about')}</Link></li>
                <li><Link href="/blog" className={linkClass}>{t('footer.blog')}</Link></li>
                <li><Link href="/contact" className={linkClass}>{t('footer.contact')}</Link></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">{t('footer.columnResources')}</h3>
              <ul className="flex flex-col gap-2">
                <li><Link href="/docs" className={linkClass}>{t('footer.docs')}</Link></li>
                <li><Link href="/blog" className={linkClass}>{t('footer.blog')}</Link></li>
                <li><Link href="/support" className={linkClass}>{t('common.support')}</Link></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">{t('footer.columnLegal')}</h3>
              <ul className="flex flex-col gap-2">
                <li><Link href="/terms" className={linkClass}>{t('footer.terms')}</Link></li>
                <li><Link href="/privacy" className={linkClass}>{t('footer.privacy')}</Link></li>
                <li><Link href="/refunds" className={linkClass}>{t('footer.refunds')}</Link></li>
                <li><Link href="/content-policy" className={linkClass}>{t('footer.contentPolicy')}</Link></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-between gap-6 border-t border-gray-800 pt-6">
          <p className="text-sm text-gray-500">
            {t('footer.copyright')}
          </p>
          {/* Social links intentionally removed until real profiles exist —
              placeholder links to twitter.com etc. read as fake to users and
              payment-provider reviewers. Restore with real URLs when live. */}
        </div>
      </div>
    </footer>
  );
}

