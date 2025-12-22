import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Providers } from "../provider";
import "../globals.css";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import StickyMobileCTA from "@/components/StickyMobileCTA";
import StructuredData from "@/components/StructuredData";
import { locales, type Locale } from '@/i18n';

export const metadata: Metadata = {
  title: "Saiflow - Sell Digital Products Online | Digital Commerce Platform",
  description: "Launch your digital products store in minutes. Sell ebooks, courses, templates & more with instant delivery, secure checkout, and no monthly fees. Join 10,000+ creators earning $1M+.",
  keywords: ["sell digital products", "digital downloads", "online courses platform", "ebook marketplace", "template store", "digital commerce", "creator economy", "gumroad alternative"],
  authors: [{ name: "Saiflow" }],
  creator: "Saiflow",
  publisher: "Saiflow",
  metadataBase: new URL("https://www.saiflow.io"),
  openGraph: {
    title: "Saiflow - Sell Digital Products the Easy Way",
    description: "Launch your shop in minutes, deliver instantly, and get paid fast. Trusted by 10,000+ creators.",
    url: "https://www.saiflow.io",
    siteName: "Saiflow",
    images: [
      {
        url: "https://www.saiflow.io/og-image.png",
        width: 1200,
        height: 630,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Saiflow - Sell Digital Products Online",
    description: "Launch your digital products store in minutes. Join 10,000+ creators.",
    images: ["https://www.saiflow.io/twitter-image.png"],
    creator: "@saiflow",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const resolvedParams = await params;
  const { locale } = resolvedParams;
  
  // Validate locale
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Load messages for the locale
  const messages = await getMessages();

  // Determine text direction
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const lang = locale;

  return (
    <html lang={lang} dir={dir}>
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        {locale === 'ar' && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet" />
          </>
        )}
        {locale === 'en' && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          </>
        )}
        <StructuredData />
      </head>
      <body className={`bg-[#0a0a0a] text-white min-h-screen antialiased ${locale === 'ar' ? 'font-[Cairo,sans-serif]' : ''}`}>
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <ErrorBoundary>
              <a href="#main-content" className="skip-to-main">
                Skip to main content
              </a>
              <Navbar />
              <main id="main-content" role="main" tabIndex={-1}>
                {children}
              </main>
              <Footer />
              <StickyMobileCTA />
            </ErrorBoundary>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

