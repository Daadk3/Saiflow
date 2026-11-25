import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import AgentsView from "@/components/agents/AgentsView";
import { agentsFont } from "@/components/agents/agents-font";

const title = "وكلاء SaiFlow الأذكياء";
const description =
  "قريبًا: حزمة جاهزة تلصقها في ChatGPT أو Claude أو Gemini، ويبدأ وكيلك العمل. Coming soon: a ready kit you paste into ChatGPT, Claude or Gemini.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/agents" },
  openGraph: {
    title: "وكلاء SaiFlow الأذكياء · SaiFlow AI Agents",
    description,
    url: "https://www.saiflow.io/agents",
    siteName: "Saiflow",
    locale: "ar_SA",
    type: "website",
  },
};

export default async function AgentsPage() {
  const locale = (await getLocale()).startsWith("en") ? "en" : "ar";
  return <AgentsView fontVariableClass={agentsFont.variable} locale={locale} />;
}
