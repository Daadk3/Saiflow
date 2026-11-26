/**
 * "Notify me" on /agents.
 *
 * Behaviour (app/api/agent-waitlist against a Prisma stand-in): a valid
 * signup is stored once per address and agent, a repeat gets the same reply,
 * bad input and unknown agents are refused, the rate limit holds, and a
 * database failure is a 503 that never logs the address. Structure: the
 * route sends no email, the migration only creates, the founder list and its
 * CSV are admin-only and safe to open in a spreadsheet.
 */
import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

type Row = { email: string; agentSlug: string; locale: string; createdAt: Date };
let rows: Row[] = [];
let failNext = false;
const upserts: Array<Record<string, unknown>> = [];

const prisma = {
  agentWaitlist: {
    upsert: async (args: {
      where: { email_agentSlug: { email: string; agentSlug: string } };
      create: { email: string; agentSlug: string; locale: string };
      update: Record<string, unknown>;
    }) => {
      upserts.push(args);
      if (failNext) {
        failNext = false;
        throw new Error("connection refused");
      }
      const key = args.where.email_agentSlug;
      const found = rows.find((r) => r.email === key.email && r.agentSlug === key.agentSlug);
      if (found) return found;
      const row = { ...args.create, createdAt: new Date() };
      rows.push(row);
      return row;
    },
  },
};

let POST: (req: Request) => Promise<Response>;
const logs: string[] = [];
let ipCounter = 0;

function signup(body: unknown, ip = `10.0.0.${++ipCounter}`): Request {
  return new Request("http://localhost/api/agent-waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma } });
  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  }
  POST = (await import("../app/api/agent-waitlist/route.ts")).POST;
});

beforeEach(() => {
  rows = [];
  upserts.length = 0;
  logs.length = 0;
  failNext = false;
});

describe("POST /api/agent-waitlist", () => {
  test("a valid signup is stored with its agent and language, and answers { ok: true }", async () => {
    const res = await POST(signup({ email: "  Sara@Example.COM ", agentSlug: "customer-service", locale: "en" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "sara@example.com");
    assert.equal(rows[0].agentSlug, "customer-service");
    assert.equal(rows[0].locale, "en");
    assert.deepEqual(upserts[0].update, {}, "a repeat must not rewrite the first signup");
  });

  test("the language defaults to Arabic", async () => {
    await POST(signup({ email: "a@example.com", agentSlug: "customer-service" }));
    assert.equal(rows[0].locale, "ar");
  });

  test("a repeat signup gets the very same reply, so the list cannot be probed", async () => {
    const first = await POST(signup({ email: "same@example.com", agentSlug: "customer-service" }));
    const again = await POST(signup({ email: "SAME@example.com", agentSlug: "customer-service" }));
    assert.equal(first.status, again.status);
    assert.deepEqual(await first.json(), await again.json());
    assert.equal(rows.length, 1);
  });

  test("the same address may wait for two different agents", async () => {
    await POST(signup({ email: "two@example.com", agentSlug: "customer-service" }));
    await POST(signup({ email: "two@example.com", agentSlug: "sales" }));
    assert.equal(rows.length, 2);
  });

  test("a bad email, an unknown agent, a bad language or broken JSON -> 400, nothing stored", async () => {
    const bad = [
      { email: "not-an-email", agentSlug: "customer-service" },
      { email: "", agentSlug: "customer-service" },
      { email: `${"a".repeat(250)}@example.com`, agentSlug: "customer-service" },
      { email: "ok@example.com", agentSlug: "not-an-agent" },
      { email: "ok@example.com", agentSlug: "" },
      { email: "ok@example.com" },
      { email: "ok@example.com", agentSlug: "customer-service", locale: "fr" },
      "{not json",
    ];
    for (const body of bad) {
      const res = await POST(signup(body));
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(await res.json(), { error: "invalid" });
    }
    assert.equal(upserts.length, 0);
  });

  test("more than five tries an hour from one network -> 429", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 5; i++) {
      const res = await POST(signup({ email: `n${i}@example.com`, agentSlug: "customer-service" }, ip));
      assert.equal(res.status, 200);
    }
    const res = await POST(signup({ email: "n6@example.com", agentSlug: "customer-service" }, ip));
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: "rate_limited" });
    assert.equal(rows.some((r) => r.email === "n6@example.com"), false);
  });

  test("more than five tries an hour for one address -> 429, whatever the network", async () => {
    for (let i = 0; i < 5; i++) {
      await POST(signup({ email: "busy@example.com", agentSlug: "customer-service" }));
    }
    const res = await POST(signup({ email: "busy@example.com", agentSlug: "customer-service" }));
    assert.equal(res.status, 429);
  });

  test("a database failure -> 503, and the address never reaches the log", async () => {
    failNext = true;
    const res = await POST(signup({ email: "secret.person@example.com", agentSlug: "customer-service" }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "unavailable" });
    assert.ok(logs.length > 0);
    assert.equal(logs.join("\n").includes("secret.person"), false);
  });
});

describe("what the route and the migration may do", () => {
  const route = read("app/api/agent-waitlist/route.ts");

  test("the route sends no email and touches no store, order or payout", () => {
    assert.equal(/resend|lib\/email|lib\/notify|sendEmail|sendMail/i.test(route), false);
    assert.equal(/prisma\.(shop|order|payout|user)\b/.test(route), false);
    assert.match(route, /export async function POST/);
    assert.equal(/export async function (GET|PUT|PATCH|DELETE)/.test(route), false);
  });

  test("the migration only creates the new table and its two indexes", () => {
    const sql = read("prisma/migrations/20261125120000_agent_waitlist/migration.sql");
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    assert.equal(statements.length, 3);
    assert.match(statements[0], /^CREATE TABLE "AgentWaitlist"/);
    assert.match(statements[1], /^CREATE UNIQUE INDEX "AgentWaitlist_email_agentSlug_key"/);
    assert.match(statements[2], /^CREATE INDEX "AgentWaitlist_createdAt_idx"/);
    assert.equal(/\b(DROP|ALTER|UPDATE|DELETE|INSERT|TRUNCATE)\b/i.test(sql.replace(/^--.*$/gm, "")), false);
  });

  test("the schema adds AgentWaitlist and leaves SellerWaitlist as it was", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model AgentWaitlist \{[\s\S]*?@@unique\(\[email, agentSlug\]\)[\s\S]*?@@index\(\[createdAt\]\)/);
    assert.match(schema, /model SellerWaitlist \{\s*id\s+String\s+@id @default\(cuid\(\)\)\s*email\s+String\s+@unique/);
  });
});

describe("the founder's list", () => {
  test("the page lives under the admin layout and is linked from the dashboard", () => {
    const page = read("app/dashboard/admin/agent-waitlist/page.tsx");
    assert.match(page, /export const dynamic = "force-dynamic"/);
    assert.match(page, /orderBy: \{ createdAt: "desc" \}/);
    assert.match(page, /formatDate\(/);
    assert.match(read("app/dashboard/admin/page.tsx"), /href="\/dashboard\/admin\/agent-waitlist"/);
    for (const lang of ["ar", "en"]) {
      const admin = JSON.parse(read(`messages/${lang}.json`)).admin;
      assert.ok(admin.actions.agentWaitlist, lang);
      for (const key of ["title", "subtitle", "count", "export", "empty", "email", "agent", "language", "date"]) {
        assert.ok(admin.agentWaitlist[key], `${lang}.${key}`);
      }
    }
  });

  test("the CSV route checks the session and the admin list itself", () => {
    const route = read("app/api/admin/agent-waitlist/route.ts");
    assert.match(route, /getServerSession\(authOptions\)/);
    assert.match(route, /isAdminEmail\(email\)/);
    assert.match(route, /status: 403/);
    assert.match(route, /text\/csv/);
    assert.match(route, /Content-Disposition": `attachment/);
  });

  test("CSV cells cannot run as spreadsheet formulas", async () => {
    const { csvCell, agentWaitlistCsv } = await import("../lib/agent-waitlist.ts");
    assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvCell("+1"), `"'+1"`);
    assert.equal(csvCell("-1"), `"'-1"`);
    assert.equal(csvCell("@SUM(A1)"), `"'@SUM(A1)"`);
    assert.equal(csvCell("plain@example.com"), `"plain@example.com"`);
    const csv = agentWaitlistCsv([
      { email: "=cmd@example.com", agentSlug: "customer-service", locale: "ar", createdAt: new Date("2026-11-25T10:00:00Z") },
    ]);
    assert.equal(
      csv,
      `"email","agent","language","signed_up_utc"\r\n"'=cmd@example.com","customer-service","ar","2026-11-25T10:00:00.000Z"\r\n`,
    );
  });

  test("page numbers from the URL are clamped", async () => {
    const { parsePage } = await import("../lib/agent-waitlist.ts");
    assert.equal(parsePage(undefined), 1);
    assert.equal(parsePage("0"), 1);
    assert.equal(parsePage("-3"), 1);
    assert.equal(parsePage("abc"), 1);
    assert.equal(parsePage("4"), 4);
    assert.equal(parsePage(["2", "9"]), 2);
  });
});
