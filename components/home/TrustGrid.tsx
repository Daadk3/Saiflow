import { getTranslations } from "next-intl/server";
import { SectionHeading } from "./SectionHeading";
import { IconLock, IconSend, IconShield, IconStore } from "./icons";

const BENEFITS = [
  { title: "securePayTitle", body: "securePayBody", Icon: IconLock },
  { title: "deliveryTitle", body: "deliveryBody", Icon: IconSend },
  { title: "scanTitle", body: "scanBody", Icon: IconShield },
  { title: "storeTitle", body: "storeBody", Icon: IconStore },
] as const;

export async function TrustGrid() {
  const t = await getTranslations("home.trust");

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading title={t("title")} align="center" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ title, body, Icon }) => (
            <li key={title} className="rounded-3xl border border-gray-800 bg-[#111111] p-6 transition hover:border-gray-700">
              <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-300">
                <Icon className="h-6 w-6" />
              </span>
              <h3 className="text-lg font-bold text-white">{t(title)}</h3>
              <p className="mt-2 text-base leading-relaxed text-gray-400">{t(body)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
