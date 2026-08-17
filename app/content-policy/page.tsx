import { getLocale } from "next-intl/server";

// Prohibited Content Policy — bilingual, Saudi-first.
// Linked from the mandatory seller certification at upload and the footer.
export default async function ContentPolicyPage() {
  const locale = await getLocale();
  const ar = locale.startsWith("ar");

  const prohibited: [string, string][] = [
    [
      "محتوى مخالف لأنظمة المملكة العربية السعودية أو أي نظام معمول به",
      "Content that violates the laws and regulations of the Kingdom of Saudi Arabia or any applicable law",
    ],
    [
      "محتوى ينتهك حقوق الملكية الفكرية — بيع أعمال الآخرين دون ترخيص",
      "Content that infringes intellectual property — selling others' work without a license",
    ],
    [
      "برمجيات ضارة أو فيروسات أو أي ملفات مصممة للإضرار بأجهزة المشترين أو بياناتهم",
      "Malware, viruses, or any files designed to harm buyers' devices or data",
    ],
    [
      "محتوى مخالف للآداب العامة أو القيم الإسلامية، أو محتوى إباحي",
      "Content contrary to public morals or Islamic values, or pornographic content",
    ],
    [
      "محتوى يحض على الكراهية أو الطائفية أو العنف أو التمييز",
      "Content promoting hatred, sectarianism, violence, or discrimination",
    ],
    [
      "القمار أو المقامرة أو أدواتهما",
      "Gambling or gambling-related products",
    ],
    [
      "محتوى احتيالي أو مضلل أو وعود عوائد مالية غير واقعية",
      "Fraudulent or deceptive content, or unrealistic financial-return promises",
    ],
    [
      "بيانات شخصية لأطراف ثالثة أو أدوات انتحال الهوية",
      "Third parties' personal data, or impersonation tools",
    ],
    [
      "محتوى يتعلق بالأسلحة أو المخدرات أو أي مواد محظورة",
      "Content related to weapons, drugs, or any prohibited materials",
    ],
    [
      "إعادة بيع منتجات رقمية اشتُريت من ساي فلو أو من منصات أخرى دون حق توزيع",
      "Reselling digital products bought on Saiflow or elsewhere without distribution rights",
    ],
  ];

  return (
    <div className="pt-16">
      <section className="pt-16 pb-12 px-4 border-b border-white/10">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            {ar ? "سياسة المحتوى" : "Content Policy"}
          </h1>
          <p className="text-gray-400">
            {ar ? "آخر تحديث: يوليو 2026" : "Last updated: July 2026"}
          </p>
        </div>
      </section>

      <main className="py-12 px-4">
        <div className="max-w-4xl mx-auto space-y-10 text-gray-300 leading-relaxed">
          <section>
            <p>
              {ar
                ? "ساي فلو منصة سعودية لبيع المنتجات الرقمية. لحماية المشترين والبائعين والمنصة، يُحظر بيع أو نشر ما يلي:"
                : "Saiflow is a Saudi marketplace for digital products. To protect buyers, sellers, and the platform, the following may not be sold or published:"}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "المحتوى المحظور" : "Prohibited Content"}
            </h2>
            <ul className="space-y-3">
              {prohibited.map(([arText, enText], i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-red-400 flex-shrink-0 mt-0.5">✕</span>
                  <span>{ar ? arText : enText}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mb-4">
              {ar ? "المراجعة والإنفاذ" : "Review & Enforcement"}
            </h2>
            <p className="mb-3">
              {ar
                ? "يُقرّ كل بائع عند رفع أي منتج بملكيته للمحتوى وقانونيته وتحمّله المسؤولية الكاملة عنه. تُراجع المنتجات الجديدة قبل ظهورها للعامة، وتُسجَّل جميع قرارات المراجعة في سجل تدقيق دائم."
                : "Every seller certifies, at upload, that they own the content, that it is legal, and that they accept full responsibility for it. New products are reviewed before they appear publicly, and all review decisions are recorded in a permanent audit log."}
            </p>
            <p>
              {ar
                ? "يحق لمنصة ساي فلو إزالة أي منتج مخالف وتعليق حساب البائع، وإبلاغ الجهات المختصة عند الاقتضاء. للإبلاغ عن محتوى مخالف: "
                : "Saiflow may remove violating products, suspend the seller's account, and report to the competent authorities where required. To report violating content: "}
              <a
                href="mailto:support@saiflow.io"
                className="text-teal-400 hover:text-teal-300 underline"
              >
                support@saiflow.io
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
