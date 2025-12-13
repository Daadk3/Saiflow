import { Providers } from "./provider";
import "./globals.css";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "Saiflow - Sell Digital Products Online",
  description: "Sell digital products, courses, and memberships. Start earning in minutes with Saiflow - the easiest way to monetize your creativity.",
  keywords: ["digital products", "sell online", "courses", "ebooks", "creator economy", "Saiflow"],
  authors: [{ name: "Saiflow" }],
  creator: "Saiflow",
  publisher: "Saiflow",
  metadataBase: new URL("https://saiflow.io"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://saiflow.io",
    siteName: "Saiflow",
    title: "Saiflow - Let Your Creativity Flow",
    description: "Sell digital products, courses, and memberships. Start earning in minutes, not months.",
    images: [
      {
        url: "/mascot.png",
        width: 800,
        height: 800,
        alt: "Saiflow - Sell Digital Products Online",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Saiflow - Let Your Creativity Flow",
    description: "Sell digital products, courses, and memberships. Start earning in minutes.",
    images: ["/mascot.png"],
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
      </head>
      <body className="bg-[#0A0A0A] min-h-screen">
        <Providers>
          <ErrorBoundary>
            <Navbar />
          </ErrorBoundary>
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
