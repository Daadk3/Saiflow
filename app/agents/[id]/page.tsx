import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import AgentDetail from "@/components/agents/AgentDetail";
import { AGENTS, getAgent } from "@/components/agents/agents-data";
import { agentsFont } from "@/components/agents/agents-font";

type Params = { id: string };

// Only the eight agents in the catalog have a page.
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return AGENTS.map((agent) => ({ id: agent.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) return {};
  const title = `${agent.nameAr} · ${agent.nameEn}`;
  const description = `${agent.descAr} ${agent.descEn}`;
  return {
    title,
    description,
    alternates: { canonical: `/agents/${agent.id}` },
    openGraph: {
      title: `${title} · وكلاء SaiFlow`,
      description,
      url: `https://www.saiflow.io/agents/${agent.id}`,
      siteName: "Saiflow",
      locale: "ar_SA",
      type: "website",
    },
  };
}

export default async function AgentPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();
  const locale = (await getLocale()).startsWith("en") ? "en" : "ar";
  return <AgentDetail agent={agent} fontVariableClass={agentsFont.variable} locale={locale} />;
}
