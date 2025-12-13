"use client";

import Link from "next/link";
import { useState } from "react";

const faqs = [
  {
    question: "When do I get paid?",
    answer: "You get paid instantly! As soon as a customer completes a purchase, the money is transferred to your connected bank account. No waiting for monthly payouts.",
  },
  {
    question: "Are there any hidden fees?",
    answer: "No hidden fees whatsoever. We only charge 9% per successful sale. No monthly fees, no setup fees, no transaction minimums. What you see is what you get.",
  },
  {
    question: "Can I sell internationally?",
    answer: "Yes! We support payments from customers worldwide. Currency conversion is handled automatically, so you can sell to anyone, anywhere.",
  },
  {
    question: "What file types can I sell?",
    answer: "You can sell PDFs, ebooks, videos, audio files (MP3, WAV), ZIP archives, images, software, templates, and more. If it's digital, you can sell it on Saiflow.",
  },
  {
    question: "Do I need technical skills?",
    answer: "Not at all! Saiflow is designed for creators, not developers. Upload your file, set a price, and share your link. That's it.",
  },
  {
    question: "Can I cancel anytime?",
    answer: "There's nothing to cancel! Since there are no monthly fees or subscriptions, you can stop using Saiflow whenever you want with no penalties.",
  },
];

export default function PricingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="pt-16 pb-16 sm:pt-24 sm:pb-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 mb-6">
            <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-teal-400 text-sm font-medium">Fair pricing for creators</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.1]">
            Simple, transparent
            <span className="block text-teal-400">pricing</span>
          </h1>

          {/* Subheadline */}
          <p className="mt-6 text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            No monthly fees. No hidden costs. Only pay when you make a sale.
          </p>
        </div>
      </section>

      {/* Pricing Card */}
      <section className="py-12 px-4">
        <div className="max-w-lg mx-auto">
          {/* Card with glow effect */}
          <div className="relative group">
            {/* Glow background */}
            <div className="absolute -inset-1 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-3xl blur-lg opacity-25 group-hover:opacity-40 transition-opacity duration-500"></div>
            
            {/* Card */}
            <div className="relative bg-[#111111] rounded-3xl border border-teal-500/30 p-8 sm:p-10">
              {/* Header */}
              <div className="text-center mb-8">
                <span className="inline-block px-4 py-1 bg-teal-500/10 text-teal-400 text-sm font-medium rounded-full mb-4">
                  Most Popular
                </span>
                <h2 className="text-2xl font-bold text-white mb-2">Creator</h2>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-5xl sm:text-6xl font-extrabold text-white">9%</span>
                  <span className="text-xl text-gray-400">per sale</span>
                </div>
                <p className="mt-2 text-gray-500">Only pay when you earn</p>
              </div>

              {/* Features */}
              <ul className="space-y-4 mb-8">
                {[
                  "Unlimited products",
                  "Unlimited sales",
                  "Secure file hosting",
                  "Instant payouts",
                  "Sales dashboard & analytics",
                  "Email notifications",
                  "Custom product links",
                  "24/7 support",
                ].map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Link
                href="/signup"
                className="block w-full py-4 px-6 bg-teal-500 hover:bg-teal-400 text-black font-semibold rounded-xl text-center transition-colors shadow-lg shadow-teal-500/25"
              >
                Start Selling — It&apos;s Free
              </Link>
              <p className="mt-4 text-center text-sm text-gray-500">
                No credit card required
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="py-20 sm:py-28 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Why creators choose Saiflow
            </h2>
            <p className="text-gray-400">
              See how we compare to other platforms
            </p>
          </div>

          {/* Comparison Table */}
          <div className="bg-[#1A1A1A] rounded-2xl border border-white/10 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-5 px-6 text-gray-400 font-medium">Feature</th>
                  <th className="text-center py-5 px-6">
                    <span className="inline-flex items-center gap-2 text-teal-400 font-semibold">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                      </svg>
                      Saiflow
                    </span>
                  </th>
                  <th className="text-center py-5 px-6 text-gray-400 font-medium">Others</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="py-5 px-6 text-gray-300">Monthly fee</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      $0
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">$29-99/mo</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-5 px-6 text-gray-300">Transaction fee</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      9%
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">5-10% + monthly</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-5 px-6 text-gray-300">Setup time</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      Minutes
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">Days/Weeks</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-5 px-6 text-gray-300">Payout speed</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      Instant
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">Weekly/Monthly</td>
                </tr>
                <tr>
                  <td className="py-5 px-6 text-gray-300">Hidden costs</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      None
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">Often yes</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 sm:py-28 px-4 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Frequently asked questions
            </h2>
            <p className="text-gray-400">
              Everything you need to know about Saiflow pricing
            </p>
          </div>

          {/* FAQ Accordion */}
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="bg-[#1A1A1A] rounded-2xl border border-white/10 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full flex items-center justify-between p-6 text-left"
                >
                  <span className="text-white font-medium pr-4">{faq.question}</span>
                  <svg
                    className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
                      openFaq === index ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === index && (
                  <div className="px-6 pb-6">
                    <p className="text-gray-400 leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 sm:py-32 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-6">
            Ready to start selling?
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Join thousands of creators who are already selling their digital products with Saiflow.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-black font-semibold px-10 py-5 rounded-full text-lg transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-xl hover:shadow-teal-500/30"
          >
            Start Selling — It&apos;s Free
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
          <p className="mt-4 text-sm text-gray-500">
            Free to start • No credit card required
          </p>
        </div>
      </section>
    </div>
  );
}
