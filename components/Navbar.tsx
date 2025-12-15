"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const startSellingHref = session ? "/dashboard" : "/signup";

  const navLinkClass =
    "text-gray-400 hover:text-white font-medium transition-colors";

  return (
    <nav
      className={`sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-gray-800 transition-shadow duration-300 ${
        scrolled ? "shadow-sm shadow-black/40" : ""
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 cursor-pointer">
            <Image
              src="/mascot.png"
              alt="Saiflow"
              width={56}
              height={56}
              className="w-14 h-14"
            />
            <span className="text-xl font-bold text-white">Saiflow</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/browse" className={navLinkClass}>
              Products
            </Link>
            <Link href="/features" className={navLinkClass}>
              Features
            </Link>
            <Link href="/pricing" className={navLinkClass}>
              Pricing
            </Link>
          </div>

          {/* Right actions */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              href="/browse"
              aria-label="Search"
              className="text-gray-500 hover:text-white transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-5 h-5"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="16.65" y1="16.65" x2="21" y2="21" />
              </svg>
            </Link>
            <Link href="/login" className={navLinkClass}>
              Login
            </Link>
            <Link
              href={startSellingHref}
              className="bg-teal-500 hover:bg-teal-600 text-white px-5 py-2 rounded-full font-medium transition-all"
            >
              Start Selling
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-gray-300 hover:text-white hover:bg-gray-800 transition"
            aria-label="Toggle navigation"
          >
            {menuOpen ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        className={`md:hidden transition-all duration-200 ${
          menuOpen ? "max-h-screen opacity-100" : "max-h-0 opacity-0 overflow-hidden"
        }`}
      >
        <div className="border-t border-gray-800 bg-[#0a0a0a] px-4 py-4 space-y-4 shadow-sm shadow-black/40">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-gray-500">Navigate</span>
            <span className="text-xs text-gray-500">{pathname}</span>
          </div>
          <div className="flex flex-col gap-3">
            <Link href="/browse" className={navLinkClass} onClick={() => setMenuOpen(false)}>
              Products
            </Link>
            <Link href="/features" className={navLinkClass} onClick={() => setMenuOpen(false)}>
              Features
            </Link>
            <Link href="/pricing" className={navLinkClass} onClick={() => setMenuOpen(false)}>
              Pricing
            </Link>
            <Link href="/login" className={navLinkClass} onClick={() => setMenuOpen(false)}>
              Login
            </Link>
            <Link
              href={startSellingHref}
              onClick={() => setMenuOpen(false)}
              className="bg-teal-500 hover:bg-teal-600 text-white px-5 py-2 rounded-full font-medium transition-all text-center"
            >
              Start Selling
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
