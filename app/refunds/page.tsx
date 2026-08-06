import { getLocale } from "next-intl/server";

// Refund Policy — bilingual, server-rendered from the locale cookie.
// Required for payment-provider review and KSA consumer-protection clarity.
export default async function RefundsPage() {
  const locale = await getLocale();
  const ar = locale.startsWith("ar");

  return (
    <div className="pt-16">
      <section className="pt-16 pb-12 px-4 border-b border-white/10">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            {ar ? "سياسة الاسترجاع" : "Refund Policy"}
          </h1>
          <p className="text-gray-400">{ar ? "آخر تحديث: يوليو 2026" : "Last updated: July 2026"}</p>
        </div>
      </section>

      <main className="py-12 px-4">
        <div className="max-w-4xl mx-auto space-y-8 text-gray-300 leading-relaxed">
          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "المنتجات الرقمية" : "Digital Products"}
            </h2>
            <p className="mb-3">
              {ar
                ? "جميع المنتجات على سيفلو منتجات رقمية تُسلَّم فورًا عبر رابط تحميل. بإتمام عملية الشراء فإنك تقر بأن تنفيذ الخدمة يبدأ فور إتاحة رابط التحميل، وبذلك يسقط حق التراجع عن الشراء وفقًا لأحكام التجارة الإلكترونية المعمول بها في المملكة العربية السعودية."
                : "All products on Saiflow are digital products delivered instantly via a download link. By completing a purchase, you acknowledge that performance begins as soon as the download link is made available to you, and that the right of withdrawal no longer applies once delivery has begun, in accordance with the e-commerce regulations of the Kingdom of Saudi Arabia."}
            </p>
            <p>
              {ar
                ? "لهذا السبب، تُعتبر المبيعات نهائية بعد إتاحة التحميل."
                : "For this reason, sales are final once the download has been made available."}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "متى يحق لك الاسترجاع" : "When You Are Entitled to a Refund"}
            </h2>
            <ul className="list-disc ps-6 space-y-2">
              <li>
                {ar
                  ? "إذا كان الملف معيبًا أو تالفًا ولا يمكن فتحه."
                  : "The file is defective or corrupted and cannot be opened."}
              </li>
              <li>
                {ar
                  ? "إذا لم تتمكن من الوصول إلى المنتج بعد الدفع ولم نستطع حل المشكلة."
                  : "You cannot access the product after payment and we are unable to resolve the issue."}
              </li>
              <li>
                {ar
                  ? "إذا كان المنتج مختلفًا جوهريًا عن وصفه المعلن."
                  : "The product is materially different from its published description."}
              </li>
              <li>
                {ar
                  ? "أي حالة أخرى يوجب فيها النظام السعودي ردّ المبلغ."
                  : "Any other case where a refund is required under Saudi law."}
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "كيفية طلب الاسترجاع" : "How to Request a Refund"}
            </h2>
            <p>
              {ar ? (
                <>
                  راسلنا على{" "}
                  <a href="mailto:support@saiflow.io" className="text-teal-400 hover:text-teal-300 underline">
                    support@saiflow.io
                  </a>{" "}
                  خلال 7 أيام من الشراء، مع ذكر البريد الإلكتروني المستخدم في الشراء واسم المنتج ووصف المشكلة. نرد على طلبات الاسترجاع خلال 3 أيام عمل.
                </>
              ) : (
                <>
                  Email{" "}
                  <a href="mailto:support@saiflow.io" className="text-teal-400 hover:text-teal-300 underline">
                    support@saiflow.io
                  </a>{" "}
                  within 7 days of purchase, including the email used for the purchase, the product name, and a description of the issue. We respond to refund requests within 3 business days.
                </>
              )}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "طريقة رد المبلغ" : "How Refunds Are Paid"}
            </h2>
            <p>
              {ar
                ? "تُرد المبالغ المعتمدة عبر وسيلة الدفع الأصلية خلال المدة التي يحددها مزود خدمة الدفع، وعادةً من 5 إلى 14 يوم عمل."
                : "Approved refunds are returned to the original payment method within the timeframe set by the payment provider, typically 5–14 business days."}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
