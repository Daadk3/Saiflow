/**
 * /agents is a static, informational catalog. It follows the approved
 * jet-black mockup, is linked from the header and footer, and its copy
 * only promises what exists: no kit to download yet, no WhatsApp date.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENTS,
  filterAgents,
  getAgent,
  mascotAlt,
  normalizeSearch,
} from "@/components/agents/agents-data";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const MASCOTS = [
  "00-saiflow-plain.png",
  "01-customer-service.png",
  "02-content-writer.png",
  "03-sales.png",
  "04-bookkeeping.png",
  "05-social-media.png",
  "06-appointments.png",
  "07-research.png",
  "08-personal-assistant.png",
];

describe("the agents catalog", () => {
  test("lists the eight approved agents, with Customer Service first and featured", () => {
    assert.equal(AGENTS.length, 8);
    assert.equal(AGENTS[0].id, "customer-service");
    assert.equal(AGENTS[0].featured, true);
    assert.equal(AGENTS[0].image, "/agents/01-customer-service.png");
    assert.equal(AGENTS.filter((agent) => agent.featured).length, 1);
    for (const agent of AGENTS) {
      assert.match(agent.image, /^\/agents\/\d{2}-[\w-]+\.png$/);
      assert.ok(agent.nameAr.length > 0);
      assert.ok(agent.nameEn.length > 0);
      assert.equal(agent.actionEn === "Notify me" || agent.actionEn === "View agent", true);
    }
  });

  test("ships every mascot used by the page", () => {
    for (const file of MASCOTS) {
      assert.ok(existsSync(resolve(ROOT, "public/agents", file)), file);
    }
  });
});

describe("the agents page matches the approved page, not a checkout", () => {
  const page = read("app/agents/page.tsx");
  const view = read("components/agents/AgentsView.tsx");
  const css = read("components/agents/agents.css");
  const nav = read("components/Navbar.tsx");
  const home = read("app/page.tsx");

  test("the route exists and does not carry the mockup-only banner", () => {
    assert.match(page, /AgentsView/);
    assert.equal(view.includes("Design mockup"), false);
    assert.equal(view.includes("نموذج تصميمي"), false);
    assert.match(view, /وكلاء/);
    assert.match(view, /SaiFlow AI Agents/);
    assert.match(view, /WhatsApp later/);
    assert.match(view, /واتساب لاحقًا/);
    assert.match(view, /ChatGPT · Claude · Gemini/);
    assert.match(view, /00-saiflow-plain\.png/);
  });

  test("the page and the cards are jet black, and the mint ring stays", () => {
    assert.match(css, /--agents-bg:\s*#000000/);
    assert.match(css, /\.agents-card\s*\{[^}]*background:\s*#000000/);
    assert.match(css, /border-color:\s*rgba\(0,\s*255,\s*179,\s*0\.55\)/);
    assert.match(css, /radial-gradient\(rgba\(255,\s*255,\s*255,\s*0\.07\)/);
  });

  test("cards do not sell anything", () => {
    assert.equal(/checkout|stripe|price|سعر|هللة/i.test(view), false);
    assert.match(view, /type="button"/);
  });

  test("the page is linked from the desktop and mobile menus and the footer, not the homepage", () => {
    assert.equal(nav.split('href="/agents"').length - 1, 2);
    assert.match(nav, /t\('agents'\)/);
    assert.match(read("components/Footer.tsx"), /href="\/agents"[^>]*>\{t\('nav\.agents'\)\}/);
    assert.equal(home.includes("/agents"), false);
  });

  test("the Agents link is translated in Arabic and English", () => {
    assert.equal(JSON.parse(read("messages/ar.json")).nav.agents, "الوكلاء");
    assert.equal(JSON.parse(read("messages/en.json")).nav.agents, "Agents");
  });

  test("the copy promises no download today and no WhatsApp date", () => {
    const how = read("components/agents/HowItWorks.tsx");
    const data = read("components/agents/agents-data.ts");
    const detail = read("components/agents/AgentDetail.tsx");
    for (const [name, text] of Object.entries({ page, view, how, data, detail })) {
      assert.equal(/Download|حمّل|WhatsApp — soon|coming later|paid upgrade|ترقية مدفوعة|تيليجرام|Telegram/.test(text), false, name);
    }
    assert.match(view, /Coming soon: a ready kit you paste into ChatGPT, Claude or Gemini/);
    assert.match(page, /قريبًا: حزمة جاهزة تلصقها/);
    assert.match(how, /How it will work at launch/);
  });
});

describe("the filter chips and the search box", () => {
  const ids = (list: { id: string }[]) => list.map((agent) => agent.id);

  test("each chip keeps only its own group", () => {
    assert.equal(filterAgents(AGENTS, "all", "").length, 8);
    assert.deepEqual(ids(filterAgents(AGENTS, "support", "")), ["customer-service"]);
    assert.deepEqual(ids(filterAgents(AGENTS, "sales", "")), ["content-writer", "sales", "social-media"]);
    assert.deepEqual(ids(filterAgents(AGENTS, "finance", "")), ["bookkeeping"]);
    assert.deepEqual(ids(filterAgents(AGENTS, "productivity", "")), [
      "appointments",
      "research",
      "personal-assistant",
    ]);
  });

  test("search matches Arabic without the shadda or with a plain haa", () => {
    assert.equal(normalizeSearch("منسّق"), "منسق");
    assert.deepEqual(ids(filterAgents(AGENTS, "all", "منسق")), ["appointments"]);
    assert.deepEqual(ids(filterAgents(AGENTS, "all", "مساعد المحاسبه")), ["bookkeeping"]);
  });

  test("search matches English names and group names, and combines with a chip", () => {
    assert.deepEqual(ids(filterAgents(AGENTS, "all", "  RESEARCH ")), ["research"]);
    assert.equal(filterAgents(AGENTS, "all", "Sales & Marketing").length, 3);
    assert.deepEqual(ids(filterAgents(AGENTS, "productivity", "sales")), []);
    assert.deepEqual(ids(filterAgents(AGENTS, "all", "no such agent")), []);
  });
});

describe("each agent has its own page", () => {
  const route = read("app/agents/[id]/page.tsx");
  const detail = read("components/agents/AgentDetail.tsx");
  const view = read("components/agents/AgentsView.tsx");

  test("the route is built for the eight agents and nothing else", () => {
    assert.match(route, /generateStaticParams/);
    assert.match(route, /dynamicParams = false/);
    assert.match(route, /notFound\(\)/);
    for (const agent of AGENTS) assert.equal(getAgent(agent.id), agent);
    assert.equal(getAgent("not-an-agent"), undefined);
  });

  test("View agent opens the agent page; Notify me stays an informational button", () => {
    assert.match(view, /href=\{href\}/);
    assert.match(view, /`\/agents\/\$\{agent\.id\}`/);
    assert.match(view, /agent\.featured \?/);
  });

  test("the page repeats the card's facts and stays honest about status", () => {
    assert.match(detail, /agent\.descAr/);
    assert.match(detail, /agent\.descEn/);
    assert.match(detail, /ChatGPT · Claude · Gemini/);
    assert.match(detail, /WhatsApp later/);
    assert.match(detail, /not available yet/);
    assert.match(detail, /متاح قريبًا/);
    assert.equal(/checkout|stripe|price|سعر|هللة|whatsapp\.com|wa\.me/i.test(detail), false);
  });

  test("mascot alt text follows the page language", () => {
    const sales = getAgent("sales")!;
    assert.equal(mascotAlt(sales, "ar"), "رسم مساعد المبيعات");
    assert.equal(mascotAlt(sales, "en"), "Sales agent illustration");
  });
});

describe("the mascots move gently and stop for reduced motion", () => {
  const css = read("components/agents/agents.css");
  const mascot = read("components/agents/Mascot.tsx");

  test("mascots use next/image, not a raw img tag", () => {
    assert.match(mascot, /from "next\/image"/);
    assert.equal(read("components/agents/AgentsView.tsx").includes("<img"), false);
  });

  test("idle, shadow and hover loops exist and animate transform or opacity only", () => {
    for (const name of ["agents-bob", "agents-shadow", "agents-hop"]) {
      const block = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`));
      assert.ok(block, name);
      const props = [...block[1].matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
      assert.ok(props.length > 0, name);
      for (const prop of props) assert.ok(prop === "transform" || prop === "opacity", `${name}: ${prop}`);
    }
  });

  test("prefers-reduced-motion turns every loop and the reveal off", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(reduced, /\.agents-mascot-bob/);
    assert.match(reduced, /\.agents-mascot-shadow/);
    assert.match(reduced, /\.agents-mascot-react/);
    assert.match(reduced, /animation: none/);
    assert.match(reduced, /\.agents-reveal[\s\S]*opacity: 1/);
  });
});
