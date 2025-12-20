"use client";

import Link from "next/link";

export function CTASection() {
  return (
    <section className="py-16 sm:py-24 px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-teal-500 to-emerald-500 opacity-90" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.2),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.15),transparent_40%)]" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white">
        <h2 className="text-3xl sm:text-4xl font-bold">Start selling today</h2>
        <p className="mt-3 text-lg text-teal-50/90">
          Create your free account and launch your shop with a clean, modern checkout experience.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signup"
            className="btn-primary"
          >
            Create your free account
          </Link>
          <Link
            href="/browse"
            className="btn-secondary"
          >
            Browse products
          </Link>
        </div>
        <p className="mt-4 text-sm text-teal-50/80">No credit card required • Free to start</p>
      </div>
    </section>
  );
}
