import { Providers } from "./provider";
import "./globals.css";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import StickyMobileCTA from "@/components/StickyMobileCTA";
import StructuredData from "@/components/StructuredData";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <StructuredData />
      </head>
      <body className="bg-[#0a0a0a] text-white min-h-screen antialiased">
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
      </body>
    </html>
  );
}
