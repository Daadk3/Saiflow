import Image from "next/image";

export function FeaturesSection() {
  return (
    <section id="features" className="py-20 sm:py-32 px-4 relative overflow-hidden">
      {/* Floating decorative mascots */}
      <div className="absolute top-20 left-4 w-24 h-24 opacity-8 animate-float pointer-events-none hidden lg:block">
        <Image
          src="/mascot-camera.png"
          alt=""
          width={96}
          height={96}
          className="w-full h-full object-contain"
        />
      </div>
      <div className="absolute bottom-20 right-4 w-20 h-20 opacity-8 animate-float-delayed pointer-events-none hidden lg:block">
        <Image
          src="/mascot-reading.png"
          alt=""
          width={80}
          height={80}
          className="w-full h-full object-contain"
        />
      </div>
      <div className="max-w-full px-4 sm:px-8 lg:px-16 xl:px-24 mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white">
            Everything you need to sell
          </h2>
          <p className="mt-4 text-xl text-gray-400 max-w-2xl mx-auto">
            No complicated setup. No monthly fees. Just you and your creativity.
          </p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1 - Sell Anything (Large) */}
          <div className="md:col-span-2 bg-[#1A1A1A] rounded-3xl p-8 border border-white/10 hover:border-teal-500/50 transition-colors group relative overflow-hidden">
            {/* Floating mascot decoration */}
            <div className="absolute -top-8 -right-8 w-32 h-32 opacity-20 animate-float-delayed pointer-events-none">
              <Image
                src="/mascot-headphones.png"
                alt=""
                width={128}
                height={128}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-6 relative z-10">
              <div className="flex-1">
                <div className="w-14 h-14 rounded-2xl bg-teal-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Sell anything digital</h3>
                <p className="text-gray-400 leading-relaxed">
                  E-books, courses, templates, music, art, software, memberships — if you can create it, you can sell it.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {["PDFs", "Videos", "Audio", "Templates", "Courses"].map((tag) => (
                    <span key={tag} className="px-3 py-1 bg-white/5 rounded-full text-sm text-gray-300 font-medium border border-white/10">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              {/* Mascot with headphones */}
              <div className="w-full sm:w-48 h-48 bg-gradient-to-br from-teal-900/40 to-cyan-900/20 rounded-2xl flex items-center justify-center border border-teal-500/20 overflow-hidden relative">
                <Image
                  src="/mascot-headphones.png"
                  alt="Mascot with headphones"
                  width={192}
                  height={192}
                  className="w-full h-full object-contain animate-float"
                />
              </div>
            </div>
          </div>

          {/* Card 2 - Get Paid */}
          <div className="bg-[#1A1A1A] rounded-3xl p-8 border border-white/10 hover:border-green-500/50 transition-colors group relative overflow-hidden">
            {/* Floating mascot decoration */}
            <div className="absolute -bottom-4 -right-4 w-24 h-24 opacity-15 animate-float pointer-events-none">
              <Image
                src="/mascot-shopping.png"
                alt=""
                width={96}
                height={96}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="relative z-10">
              <div className="w-14 h-14 rounded-2xl bg-green-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Get paid instantly</h3>
              <p className="text-gray-400 leading-relaxed mb-6">
                Accept payments from anywhere. Support for local and international cards. Get your money fast.
              </p>
              {/* Mascot with shopping bag */}
              <div className="w-full h-32 bg-gradient-to-br from-green-900/30 to-emerald-900/20 rounded-2xl flex items-center justify-center border border-green-500/20 overflow-hidden mb-4">
                <Image
                  src="/mascot-shopping.png"
                  alt="Mascot with shopping bag"
                  width={128}
                  height={128}
                  className="w-24 h-24 object-contain animate-float-delayed"
                />
              </div>
              <ul className="space-y-2">
                {["Global payments", "Instant transfers", "Secure checkout"].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-400 text-sm">
                    <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Card 3 - Simple Pricing */}
          <div className="bg-gradient-to-br from-teal-900 to-teal-800 rounded-3xl p-8 border border-teal-500/30 group text-white">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold mb-3">Simple pricing</h3>
            <p className="text-teal-100/70 leading-relaxed mb-6">
              No monthly fees. No setup costs. Just a small percentage when you make a sale.
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-extrabold">9%</span>
              <span className="text-teal-200/60">per sale</span>
            </div>
          </div>

          {/* Card 4 - Track Sales */}
          <div className="md:col-span-2 bg-[#1A1A1A] rounded-3xl p-8 border border-white/10 hover:border-purple-500/50 transition-colors group relative overflow-hidden">
            {/* Floating mascot decoration */}
            <div className="absolute -top-6 -left-6 w-28 h-28 opacity-15 animate-float pointer-events-none">
              <Image
                src="/mascot-tablet.png"
                alt=""
                width={112}
                height={112}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-6 relative z-10">
              <div className="flex-1">
                <div className="w-14 h-14 rounded-2xl bg-purple-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-white mb-3">Track your sales</h3>
                <p className="text-gray-400 leading-relaxed">
                  Beautiful dashboard to see your revenue, customers, and product performance. Know what&apos;s working.
                </p>
              </div>
              {/* Mascot with tablet */}
              <div className="w-full sm:w-48 h-48 bg-gradient-to-br from-purple-900/30 to-pink-900/20 rounded-2xl flex items-center justify-center border border-purple-500/20 overflow-hidden relative">
                <Image
                  src="/mascot-tablet.png"
                  alt="Mascot with tablet"
                  width={192}
                  height={192}
                  className="w-full h-full object-contain animate-float-delayed"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
