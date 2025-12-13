"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export default function Footer() {
  const pathname = usePathname();

  // Don't show footer on dashboard pages
  if (pathname?.startsWith("/dashboard")) {
    return null;
  }

  return (
    <footer className="border-t border-white/10 bg-[#0A0A0A] py-12 px-4">
      <div className="max-w-full px-4 sm:px-8 lg:px-16 xl:px-24 mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/mascot.png"
              alt="Saiflow"
              width={32}
              height={32}
              className="h-8 w-auto object-contain"
            />
            <span className="text-lg font-bold text-white">Saiflow</span>
          </Link>

          {/* Links */}
          <div className="flex items-center gap-8">
            <Link href="/features" className="text-gray-500 hover:text-white text-sm font-medium transition-colors">Features</Link>
            <Link href="/pricing" className="text-gray-500 hover:text-white text-sm font-medium transition-colors">Pricing</Link>
            <Link href="/terms" className="text-gray-500 hover:text-white text-sm font-medium transition-colors">Terms</Link>
            <Link href="/privacy" className="text-gray-500 hover:text-white text-sm font-medium transition-colors">Privacy</Link>
          </div>

          {/* Built with love */}
          <p className="text-gray-500 text-sm">
            Built with <span className="text-red-500">❤️</span> by Saiflow
          </p>
        </div>

        <div className="mt-8 pt-8 border-t border-white/5 text-center">
          <p className="text-gray-600 text-sm">
            © {new Date().getFullYear()} Saiflow. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

