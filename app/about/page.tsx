import { getLocale } from "next-intl/server";

// Company information page — bilingual, server-rendered from the locale cookie.
// Discloses the operating entity as required by the KSA E-Commerce Law and
// expected in payment-provider website reviews.
export default async function AboutPage() {
  const locale = await getLocale();
  const ar = locale.startsWith("ar");

  return (
    <div className="pt-16">
      <section className="pt-16 pb-12 px-4 border-b border-white/10">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            {ar ? "عن سيفلو" : "About Saiflow"}
          </h1>
          <p className="text-gray-400">
            {ar
              ? "منصة سعودية لبيع المنتجات الرقمية"
              : "A Saudi marketplace for digital products"}
          </p>
        </div>
      </section>

      <main className="py-12 px-4">
        <div className="max-w-4xl mx-auto space-y-8 text-gray-300 leading-relaxed">
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "ما هي سيفلو؟" : "What is Saiflow?"}
            </h2>
            <p>
              {ar
                ? "سيفلو منصة عربية أولًا تمكّن صنّاع المحتوى من بيع منتجاتهم الرقمية — كتب إلكترونية، قوالب، دورات، ملفات تصميم — مباشرة إلى جمهورهم، بالريال السعودي وبتجربة شراء بسيطة وآمنة."
                : "Saiflow is an Arabic-first platform that lets creators sell their digital products — e-books, templates, courses, design files — directly to their audience, priced in Saudi Riyal with a simple, secure purchase experience."}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "معلومات المنشأة" : "Company Information"}
            </h2>
            <div className="rounded-xl border border-gray-800 bg-[#111] p-6 space-y-3">
              <p>
                <span className="text-gray-500">{ar ? "الاسم التجاري:" : "Trade name:"}</span>{" "}
                <span className="text-white font-semibold">Saiflow</span>
              </p>
              <p>
                <span className="text-gray-500">{ar ? "المنشأة المشغّلة:" : "Operated by:"}</span>{" "}
                <span className="text-white font-semibold">
                  {ar ? "[مؤسسة نوفاسفير للتسويق]" : "[NovaSphere Marketing Establishment]"}
                </span>
              </p>
              <p>
                <span className="text-gray-500">{ar ? "السجل التجاري:" : "Commercial Registration:"}</span>{" "}
                <span className="text-white font-semibold">[CR NUMBER]</span>
              </p>
              <p>
                <span className="text-gray-500">{ar ? "المقر:" : "Location:"}</span>{" "}
                <span className="text-white font-semibold">
                  {ar ? "الرياض، المملكة العربية السعودية" : "Riyadh, Kingdom of Saudi Arabia"}
                </span>
              </p>
              <p>
                <span className="text-gray-500">{ar ? "التواصل:" : "Contact:"}</span>{" "}
                <a href="mailto:support@saiflow.io" className="text-teal-400 hover:text-teal-300 underline">
                  support@saiflow.io
                </a>
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
