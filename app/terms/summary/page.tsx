import type { Metadata } from "next";
import Link from "next/link";
import { getLocale } from "next-intl/server";

export const metadata: Metadata = { title: "Terms summary | SaiFlow" };

/**
 * A short, non-legal explanation of how selling works today.
 * The full Terms of Service stay at /terms and are not rewritten here.
 */
export default async function TermsSummaryPage() {
  const ar = (await getLocale()).startsWith("ar");

  return (
    <div className="pt-16">
      <section className="border-b border-white/10 px-4 pb-12 pt-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-4xl font-extrabold text-white sm:text-5xl">
            {ar ? "ملخص الشروط" : "Terms summary"}
          </h1>
          <p className="text-gray-400">
            {ar
              ? "هذا شرح مختصر لوضع البيع اليوم. النص القانوني الكامل في صفحة الشروط، وهذا الملخص لا يغيّره."
              : "A short explanation of how selling works today. The full legal text is on the Terms page, and this summary does not change it."}
          </p>
        </div>
      </section>

      <main className="px-4 py-12">
        <div className="mx-auto max-w-3xl space-y-8 text-lg leading-relaxed text-gray-300">
          <section>
            <h2 className="mb-3 text-2xl font-bold text-white">
              {ar ? "متاجر ساي فلو" : "SaiFlow's own stores"}
            </h2>
            <p>
              {ar
                ? "متاجر ساي فلو التي يديرها صاحب المنصة تعمل وتبيع الآن. المنتجات المعروضة فيها لها زر شراء، وصفحة الدفع موجودة. المنتجات بالعربية والإنجليزية."
                : "The stores SaiFlow itself runs are live and selling now. Those products have a real Buy button, and the checkout exists. Products are in Arabic and English."}
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-white">
              {ar ? "البائعون من خارج المنصة" : "Outside sellers"}
            </h2>
            <p>
              {ar
                ? "فتح متجر لبائع من خارج المنصة وصول مبكر. يمكنك تجهيز متجرك الآن. تحويلات أرباح البائعين الخارجيين تبدأ عند الإطلاق، والموعد ما زال قيد التأكيد. إطلاق السوق متعدد البائعين لم يتم بعد."
                : "Opening a shop as an outside seller is early access. You can prepare your store now. Outside-seller payouts start at launch, and the timing is still to be confirmed. The multi-seller marketplace has not launched yet."}
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-white">
              {ar ? "العمولة" : "Commission"}
            </h2>
            <p>
              {ar
                ? "عمولة ٧٪ وعدم وجود رسوم شهرية شروط مبدئية تُعتمد قبل الإطلاق."
                : "A 7% commission and no monthly fee are planned terms, finalized before launch."}
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-2xl font-bold text-white">
              {ar ? "المشترون" : "Buyers"}
            </h2>
            <p>
              {ar
                ? "يمكن تصفّح المنتجات المتاحة وشراؤها من المتاجر التي تبيع الآن. المشترون الدوليون غير مفعّلين بعد."
                : "You can browse and buy products that are on sale now. International buyers are not active yet."}
            </p>
          </section>

          <p>
            <Link href="/terms" className="text-teal-400 underline hover:text-teal-300">
              {ar ? "اقرأ الشروط كاملة" : "Read the full terms"}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
