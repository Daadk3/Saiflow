import Link from "next/link";
import Image from "next/image";

export function CTASection() {
  return (
    <section className="py-20 sm:py-32 px-4 relative overflow-hidden">
      {/* Floating decorative mascots */}
      <div className="absolute top-10 left-10 w-20 h-20 opacity-10 animate-float pointer-events-none hidden lg:block">
        <Image
          src="/mascot-camera.png"
          alt=""
          width={80}
          height={80}
          className="w-full h-full object-contain"
        />
      </div>
      <div className="absolute bottom-10 right-10 w-24 h-24 opacity-10 animate-float-delayed pointer-events-none hidden lg:block">
        <Image
          src="/mascot-reading.png"
          alt=""
          width={96}
          height={96}
          className="w-full h-full object-contain"
        />
      </div>

      <div className="max-w-full px-4 sm:px-8 lg:px-16 xl:px-24 mx-auto text-center relative z-10">
        {/* Mascot near CTA */}
        <div className="flex justify-center mb-8">
          <div className="w-32 h-32 sm:w-40 sm:h-40 animate-float">
            <Image
              src="/mascot-reading.png"
              alt="Mascot reading"
              width={160}
              height={160}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
        <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-6">
          Ready to start earning?
        </h2>
        <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          Join thousands of creators who are already selling their digital products with Saiflow.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black font-semibold px-10 py-5 rounded-full text-lg transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-xl hover:shadow-teal-500/30"
        >
          Create Your Free Store
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>
        <p className="mt-4 text-sm text-gray-500">
          Free to start - No credit card required
        </p>
      </div>
    </section>
  );
}
