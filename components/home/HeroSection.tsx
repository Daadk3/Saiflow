import Link from "next/link";
import Image from "next/image";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white via-white to-gray-50">
      {/* Background shapes */}
      <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-teal-100 blur-3xl" />
      <div className="absolute top-10 right-10 h-64 w-64 rounded-full bg-cyan-50 blur-3xl" />
      <div className="absolute bottom-[-120px] left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-teal-50 blur-3xl" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 lg:pt-28 lg:pb-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left */}
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700 border border-teal-100">
              <span className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
              Built for modern creators
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">
              Sell your digital products the easy way
            </h1>
            <p className="text-lg sm:text-xl text-gray-600 max-w-xl">
              Launch your shop in minutes, deliver instantly, and get paid fast. No headaches, just a clean,
              modern checkout for you and your customers.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-teal-500 px-6 sm:px-8 py-3 text-white font-semibold shadow-sm transition hover:bg-teal-600"
              >
                Start Selling →
              </Link>
              <Link
                href="/browse"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-gray-300 px-6 sm:px-8 py-3 text-gray-800 font-semibold bg-white transition hover:border-teal-200 hover:text-teal-700"
              >
                Browse Products
              </Link>
            </div>

            {/* Social proof quick row */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-teal-100 border border-teal-200 flex items-center justify-center text-teal-700 text-xs font-semibold">
                  10k
                </div>
                Trusted creators
              </div>
              <span className="h-1 w-1 rounded-full bg-gray-300" />
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 text-xs font-semibold">
                  $1M+
                </div>
                Earned through Saiflow
              </div>
            </div>
          </div>

          {/* Right visuals */}
          <div className="relative">
            <div className="absolute -inset-6 rounded-[32px] bg-gradient-to-br from-teal-100 via-white to-cyan-50 blur-2xl" />
            <div className="relative rounded-[28px] border border-gray-100 bg-white shadow-lg shadow-gray-100 p-6">
              {/* Mock header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Image src="/mascot.png" alt="Saiflow mascot" width={40} height={40} className="h-10 w-10" />
                  <div>
                    <p className="text-sm text-gray-500">Saiflow Shop</p>
                    <p className="text-base font-semibold text-gray-900">Digital Creator Store</p>
                  </div>
                </div>
                <span className="rounded-full bg-teal-50 text-teal-700 text-sm font-semibold px-3 py-1">
                  Live
                </span>
              </div>

              {/* Floating product mockups */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { title: "Course Bundle", price: "$129", color: "from-teal-500/90 to-emerald-500/80" },
                  { title: "Ebook Pack", price: "$39", color: "from-sky-500/90 to-blue-500/80" },
                  { title: "UI Kit", price: "$69", color: "from-amber-500/90 to-orange-500/80" },
                  { title: "Preset Pack", price: "$19", color: "from-purple-500/90 to-indigo-500/80" },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md transition"
                  >
                    <div
                      className={`h-20 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center text-white font-semibold text-lg mb-3`}
                    >
                      {item.title}
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-600">
                      <span>{item.price}</span>
                      <span className="flex items-center gap-1 text-teal-600 font-semibold">
                        Buy
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0-4 4m4-4H3" />
                        </svg>
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom stat */}
              <div className="mt-6 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div>
                  <p className="text-sm text-gray-500">Recent sale</p>
                  <p className="text-base font-semibold text-gray-900">+$49 from Sarah</p>
                </div>
                <span className="text-sm font-semibold text-teal-700 bg-teal-50 px-3 py-1 rounded-full">
                  2m ago
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
