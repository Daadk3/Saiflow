import { getLocale, getTranslations } from "next-intl/server";
import { SectionHeading } from "./SectionHeading";
import { IconSend, IconStore, IconUpload } from "./icons";

const STEPS = [
  { number: 1, title: "step1Title", body: "step1Body", Icon: IconStore },
  { number: 2, title: "step2Title", body: "step2Body", Icon: IconUpload },
  { number: 3, title: "step3Title", body: "step3Body", Icon: IconSend },
] as const;

export async function SellSteps() {
  const t = await getTranslations("home.steps");
  const locale = await getLocale();
  const digits = new Intl.NumberFormat(locale);

  return (
    <section id="how-to-sell" className="scroll-mt-24 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading title={t("title")} align="center" />
        <ol className="grid gap-5 md:grid-cols-3">
          {STEPS.map(({ number, title, body, Icon }) => (
            <li
              key={number}
              className="relative rounded-3xl border border-gray-800 bg-[#111111] p-7 transition hover:border-gray-700"
            >
              <div className="mb-6 flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-300">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="text-sm font-semibold text-gray-500">{t("stepLabel", { number: digits.format(number) })}</span>
              </div>
              <h3 className="text-xl font-bold text-white sm:text-2xl">{t(title)}</h3>
              <p className="mt-2 text-base leading-relaxed text-gray-400">{t(body)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
