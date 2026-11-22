import { getLocale } from "next-intl/server";
import { LEGAL, establishmentName } from "@/lib/legal";

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
            {ar ? "عن ساي فلو" : "About Saiflow"}
          </h1>
          <p className="text-gray-400">
            {ar
              ? "منصة عربية أولًا للمنتجات الرقمية بالعربية والإنجليزية"
              : "An Arabic-first marketplace for digital products in Arabic and English"}
          </p>
        </div>
      </section>

      <main className="py-12 px-4">
        <div className="max-w-4xl mx-auto space-y-8 text-gray-300 leading-relaxed">
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "ما هي ساي فلو؟" : "What is Saiflow?"}
            </h2>
            <p>
              {ar
                ? "ساي فلو منصة عربية أولًا للمنتجات الرقمية باللغتين العربية والإنجليزية. متاجر ساي فلو نفسها تعمل وتبيع الآن، ويمكن شراء المنتجات المتاحة منها. فتح متجر لبائع من خارج المنصة وصول مبكر: تجهيز المتجر متاح اليوم، وتبدأ تحويلات أرباح البائعين الخارجيين عند الإطلاق، والموعد سيُؤكد لاحقًا. إطلاق السوق متعدد البائعين لم يتم بعد."
                : "Saiflow is an Arabic-first platform for digital products in Arabic and English. SaiFlow's own stores are live and selling now, and you can buy the products they offer. Opening a shop as an outside seller is early access: you can prepare a store today, and outside-seller payouts start at launch. The timing is still to be confirmed. The multi-seller marketplace has not launched yet."}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "معلومات المنشأة" : "Company Information"}
            </h2>
            <div className="rounded-xl border border-gray-800 bg-[#111] p-6 space-y-3">
              <p>
                <span className="text-gray-500">{ar ? "اسم المتجر:" : "Store name:"}</span>{" "}
                <span className="text-white font-semibold">
                  {/* Both renderings are shown in both locales: the registered
                      Arabic store name is what a Saudi Business Center reviewer
                      matches against the record, whichever language they read
                      the page in. */}
                  {LEGAL.storeNameEn} — {LEGAL.storeNameAr}
                </span>
              </p>
              <p>
                <span className="text-gray-500">{ar ? "المنشأة المشغّلة:" : "Operated by:"}</span>{" "}
                <span className="text-white font-semibold">{establishmentName(ar)}</span>
              </p>
              <p>
                <span className="text-gray-500">{ar ? "السجل التجاري:" : "Commercial Registration:"}</span>{" "}
                {/* bdi: the registration number is a Latin-digit sequence and
                    must not be reordered by the surrounding RTL paragraph. */}
                <bdi className="text-white font-semibold">{LEGAL.crNumber}</bdi>
              </p>
              <p>
                {/* E-commerce authentication, placed directly under the
                    commercial registration: they are the two credentials a
                    Saudi Business Center reviewer checks together. The issuing
                    authority is named after the number so the row stands on its
                    own away from the footer. */}
                <span className="text-gray-500">
                  {ar ? "توثيق التجارة الإلكترونية:" : "E-Commerce Authentication:"}
                </span>{" "}
                <bdi className="text-white font-semibold">{LEGAL.sbcAuthNumber}</bdi>
                <span className="text-gray-500">
                  {ar ? " — المركز السعودي للأعمال" : " — Saudi Business Center"}
                </span>
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
