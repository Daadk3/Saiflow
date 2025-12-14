"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";

export default function Navbar() {
  const { data: session } = useSession();
  const logoHref = session ? "/dashboard" : "/";

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-sm border-b border-gray-800">
      <div className="max-w-full mx-auto px-4 sm:px-8 lg:px-16 xl:px-24">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href={logoHref} className="flex items-center space-x-2">
            <Image src="/mascot.png" alt="Saiflow" width={40} height={40} />
            <span className="text-white font-semibold text-xl">Saiflow</span>
          </Link>

          {/* Center Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <Link href="/browse" className="text-gray-300 hover:text-white transition">Products</Link>
            <Link href="/features" className="text-gray-300 hover:text-white transition">Features</Link>
            <Link href="/pricing" className="text-gray-300 hover:text-white transition">Pricing</Link>
          </div>

          {/* Right Navigation */}
          <div className="flex items-center space-x-4">
            <Link href="/support" className="text-gray-300 hover:text-white transition">Support</Link>
            
            {session ? (
              <>
                <Link href="/dashboard" className="text-gray-300 hover:text-white transition">Dashboard</Link>
                <button 
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="text-gray-300 hover:text-white transition"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-gray-300 hover:text-white transition">Login</Link>
                <Link 
                  href="/signup" 
                  className="bg-[#00D094] hover:bg-[#00b880] text-black font-medium px-4 py-2 rounded-full transition"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
