import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import AgentsView from "@/components/agents/AgentsView";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  variable: "--font-agents",
});

const title = "وكلاء SaiFlow الأذكياء";
const description =
  "حمّل الوكيل، والصقه في ChatGPT أو Claude أو Gemini، ويبدأ العمل فورًا. Download, paste into ChatGPT, Claude or Gemini, and it starts working.";

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

export default function AgentsPage() {
  return <AgentsView fontVariableClass={cairo.variable} />;
}
