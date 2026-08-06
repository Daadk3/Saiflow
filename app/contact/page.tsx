import Link from "next/link";
import { getLocale } from "next-intl/server";

// Contact page — bilingual, server-rendered from the locale cookie.
// A working contact channel is required by KSA consumer-protection rules.
export default async function ContactPage() {
  const locale = await getLocale();
  const ar = locale.startsWith("ar");

  return (
    <div className="pt-16">
      <section className="pt-16 pb-12 px-4 border-b border-white/10">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            {ar ? "تواصل معنا" : "Contact Us"}
          </h1>
          <p className="text-gray-400">
            {ar
              ? "نرد على جميع الرسائل خلال يوم عمل واحد."
              : "We reply to all messages within one business day."}
          </p>
        </div>
      </section>

      <main className="py-12 px-4">
        <div className="max-w-4xl mx-auto space-y-6 text-gray-300 leading-relaxed">
          <div className="rounded-xl border border-gray-800 bg-[#111] p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white mb-1">
                {ar ? "الدعم والاستفسارات" : "Support & Inquiries"}
              </h2>
              <a
                href="mailto:support@saiflow.io"
                className="text-teal-400 hover:text-teal-300 underline text-lg"
              >
                support@saiflow.io
              </a>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white mb-1">
                {ar ? "الأسئلة الشائعة" : "Frequently Asked Questions"}
              </h2>
              <p>
                {ar ? (
                  <>
                    تجد إجابات الأسئلة الشائعة في{" "}
                    <Link href="/support" className="text-teal-400 hover:text-teal-300 underline">
                      صفحة الدعم
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Answers to common questions are on the{" "}
                    <Link href="/support" className="text-teal-400 hover:text-teal-300 underline">
                      support page
                    </Link>
                    .
                  </>
                )}
              </p>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white mb-1">
                {ar ? "المنشأة" : "Company"}
              </h2>
              <p>
                {ar ? (
                  <>
                    معلومات المنشأة والسجل التجاري في{" "}
                    <Link href="/about" className="text-teal-400 hover:text-teal-300 underline">
                      صفحة عن سيفلو
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Company and registration details are on the{" "}
                    <Link href="/about" className="text-teal-400 hover:text-teal-300 underline">
                      about page
                    </Link>
                    .
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
