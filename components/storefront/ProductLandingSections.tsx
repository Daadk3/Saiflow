import type { ReactNode } from "react";
import { hasLandingContent, type ProductLanding } from "@/lib/product-landing";

export interface LandingLabels {
  audience: string;
  benefits: string;
  included: string;
  faq: string;
  guarantee: string;
}

/**
 * The optional long page under the hero. Renders nothing when the seller
 * left every section blank, so an existing product looks unchanged.
 *
 * Seller text sets its own direction per line, the same way the description
 * does, so Arabic and English can share a section. Headings follow the page.
 */
export function ProductLandingSections({
  landing,
  labels,
  children,
}: {
  landing: ProductLanding | null;
  labels: LandingLabels;
  /** Repeated buy control. Omitted on the moderation preview, which cannot sell. */
  children?: ReactNode;
}) {
  if (!hasLandingContent(landing) || !landing) return null;

  return (
    <div className="mt-16 space-y-12 border-t border-gray-800 pt-12">
      {landing.audience && (
        <section aria-labelledby="product-audience">
          <h2 id="product-audience" className="text-xl font-semibold text-white sm:text-2xl">
            {labels.audience}
          </h2>
          <p dir="auto" className="mt-4 whitespace-pre-wrap text-start text-base leading-relaxed text-gray-300 [unicode-bidi:plaintext]">
            {landing.audience}
          </p>
        </section>
      )}

      {landing.benefits.length > 0 && (
        <section aria-labelledby="product-benefits">
          <h2 id="product-benefits" className="text-xl font-semibold text-white sm:text-2xl">
            {labels.benefits}
          </h2>
          <ul className="mt-5 space-y-3">
            {landing.benefits.map((benefit, index) => (
              <li key={`${index}-${benefit}`} className="flex items-start gap-3 text-gray-200">
                <span className="mt-0.5 text-teal-400" aria-hidden="true">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span dir="auto" className="text-start leading-relaxed [unicode-bidi:plaintext]">
                  {benefit}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {landing.included.length > 0 && (
        <section aria-labelledby="product-inside">
          <h2 id="product-inside" className="text-xl font-semibold text-white sm:text-2xl">
            {labels.included}
          </h2>
          <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {landing.included.map((item, index) => (
              <li
                key={`${index}-${item}`}
                className="flex items-start gap-3 rounded-xl border border-gray-800 bg-[#111111] px-4 py-3 text-gray-200"
              >
                <span className="mt-0.5 text-teal-400" aria-hidden="true">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </span>
                <span dir="auto" className="text-start leading-relaxed [unicode-bidi:plaintext]">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {landing.faq.length > 0 && (
        <section aria-labelledby="product-faq">
          <h2 id="product-faq" className="text-xl font-semibold text-white sm:text-2xl">
            {labels.faq}
          </h2>
          <div className="mt-5 divide-y divide-gray-800 overflow-hidden rounded-2xl border border-gray-800 bg-[#111111]">
            {landing.faq.map((item, index) => (
              <div key={`${index}-${item.question}`} className="px-4 py-5 sm:px-6">
                <h3 dir="auto" className="text-start text-base font-medium text-white [unicode-bidi:plaintext]">
                  {item.question}
                </h3>
                <p dir="auto" className="mt-2 whitespace-pre-wrap text-start text-sm leading-relaxed text-gray-300 [unicode-bidi:plaintext]">
                  {item.answer}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {landing.guarantee && (
        <section aria-labelledby="product-guarantee" className="rounded-2xl border border-teal-500/30 bg-teal-500/10 px-5 py-5 sm:px-6">
          <h2 id="product-guarantee" className="text-lg font-semibold text-teal-200">
            {labels.guarantee}
          </h2>
          <p dir="auto" className="mt-2 whitespace-pre-wrap text-start text-sm leading-relaxed text-teal-50/90 [unicode-bidi:plaintext]">
            {landing.guarantee}
          </p>
        </section>
      )}

      {children ? <div className="max-w-md">{children}</div> : null}
    </div>
  );
}
