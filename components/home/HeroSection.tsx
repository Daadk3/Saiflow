import Link from "next/link";
import Image from "next/image";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-4 pt-16 pb-16 sm:pt-24 sm:pb-24">
      {/* Animated gradient background */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(120deg, rgba(0,208,148,0.18), rgba(157,78,221,0.18), rgba(0,102,204,0.2), rgba(255,107,157,0.15))",
          backgroundSize: "200% 200%",
          filter: "blur(30px)",
        }}
      />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(0,208,148,0.15),transparent_35%),radial-gradient(circle_at_80%_30%,rgba(255,107,157,0.12),transparent_30%),radial-gradient(circle_at_40%_80%,rgba(157,78,221,0.15),transparent_30%)] animate-pulse" />
      {/* Blurred orbs */}
      <div className="absolute -top-10 -left-10 h-72 w-72 rounded-full bg-[#FF6B9D]/20 blur-[90px]" />
      <div className="absolute top-20 -right-20 h-80 w-80 rounded-full bg-[#9D4EDD]/15 blur-[100px]" />
      <div className="absolute bottom-0 right-10 h-72 w-72 rounded-full bg-[#FF9F1C]/12 blur-[90px]" />

      <div className="w-full px-4 sm:px-8 lg:px-16 xl:px-24 relative z-10">
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-12">
          {/* Left - Sellers */}
          <div className="text-center lg:text-left space-y-6 lg:max-w-xl xl:max-w-2xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-200 text-sm font-medium">
              <span className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
              Built for creators across MENA & beyond
            </div>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-white tracking-tight leading-[1.05]">
              Let your
              <span className="block text-teal-300">creativity flow</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Sell digital products, courses, and memberships. Start earning in minutes, not months.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
              <Link
                href="/signup"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-400 text-black font-semibold px-8 py-4 rounded-full transition-all duration-200 shadow-lg shadow-teal-500/30 hover:shadow-xl hover:shadow-teal-500/40"
              >
                Start Selling — It&apos;s Free
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <Link
                href="/browse"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white font-semibold px-8 py-4 rounded-full border border-white/10 hover:border-white/20 transition-all duration-200"
              >
                Browse Products
              </Link>
            </div>
          </div>

          {/* Right - Buyers visuals */}
          <div className="relative flex items-center justify-center lg:justify-end lg:scale-110 xl:scale-125 origin-center lg:origin-right">
            {/* Mascot */}
            <div className="relative">
              <Image
                src="/logo.png"
                alt="Saiflow mascot - a friendly teal blob character with laptop"
                width={456}
                height={456}
                className="w-72 sm:w-80 lg:w-96 h-auto drop-shadow-2xl"
              />
              <div className="absolute inset-0 -z-10 bg-teal-500/30 blur-[80px] rounded-full scale-90" />
            </div>

            {/* Floating cards */}
            <div className="absolute -left-6 sm:left-0 top-12 w-52 rounded-2xl bg-[#1A1A1A] border border-pink-400/40 p-4 shadow-2xl animate-bounce">
              <p className="text-xs text-pink-200/90">New sale!</p>
              <p className="text-2xl font-bold text-white">+$49.00</p>
              <div className="mt-2 text-xs text-gray-400">ebook-bundle.pdf</div>
            </div>

            <div className="absolute -right-4 sm:right-0 bottom-8 w-56 rounded-2xl bg-[#181326] border border-purple-400/40 p-4 shadow-2xl animate-pulse">
              <p className="text-xs text-purple-200/90">Downloads</p>
              <p className="text-2xl font-bold text-white">2,847</p>
              <div className="mt-2 text-xs text-gray-400">Last 30 days</div>
            </div>

            <div className="absolute -left-10 sm:-left-6 bottom-14 w-48 rounded-2xl bg-[#201107] border border-orange-300/50 p-4 shadow-2xl animate-pulse">
              <p className="text-xs text-orange-200/90">Store rating</p>
              <p className="text-2xl font-bold text-white">4.9</p>
              <div className="mt-2 text-xs text-gray-400">Based on 1,240 reviews</div>
            </div>
          </div>
        </div>

        {/* Trust banner */}
        <div className="mt-14 w-full rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-teal-500/20 border border-teal-400/40 flex items-center justify-center">
              <svg className="w-5 h-5 text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-gray-300">Join</p>
              <p className="text-lg font-semibold text-white">
                1,000+ creators already earning
              </p>
            </div>
          </div>
          <div className="flex -space-x-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-10 w-10 rounded-full border-2 border-[#0a0a0a] bg-gradient-to-br from-[#FF6B9D] via-[#9D4EDD] to-[#00D094] flex items-center justify-center text-white text-sm font-semibold"
              >
                {i}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
