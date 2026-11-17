/**
 * /agents is a static, informational catalog. It follows the approved
 * jet-black mockup and stays out of the main navigation until the owner
 * asks for that link.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS } from "@/components/agents/agents-data";

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
    assert.match(view, /WhatsApp — soon/);
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

  test("the page is not in the main nav or the homepage", () => {
    assert.equal(nav.includes('href="/agents"'), false);
    assert.equal(home.includes("/agents"), false);
  });
});
