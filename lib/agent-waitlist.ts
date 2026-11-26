import { AGENTS } from "@/components/agents/agents-data";

/** Rows per page on the founder's agent waitlist. */
export const AGENT_WAITLIST_PAGE_SIZE = 50;

export type AgentWaitlistRow = {
  email: string;
  agentSlug: string;
  locale: string;
  createdAt: Date;
};

/** The agent's English and Arabic name, or the raw slug if it was renamed. */
export function agentLabel(slug: string, locale: string): string {
  const agent = AGENTS.find((item) => item.id === slug);
  if (!agent) return slug;
  return locale.startsWith("ar") ? agent.nameAr : agent.nameEn;
}

/** A 1-based page number from the query string; anything odd is page 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Number.parseInt(value ?? "", 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

/**
 * One CSV cell. A value that a spreadsheet would read as a formula
 * (= + - @, or a tab or carriage return in front) gets a leading quote mark,
 * and every cell is quoted so commas and line breaks stay inside it.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function agentWaitlistCsv(rows: AgentWaitlistRow[]): string {
  const lines = [["email", "agent", "language", "signed_up_utc"].map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [row.email, row.agentSlug, row.locale, row.createdAt.toISOString()].map(csvCell).join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
