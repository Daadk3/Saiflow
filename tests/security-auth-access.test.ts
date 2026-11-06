/**
 * Security fixes: sign-in and access (review of main 4f3a1a0, 2026-10-19).
 *
 * What must hold:
 * - Every Founder Dashboard server page checks admin access itself before
 *   it reads any data; a layout's check alone is not enough in Next.js.
 * - Password reset: the link goes to the address stored on the account (not
 *   the one typed in); only the token's hash is stored; the reply is the same
 *   whether or not an account exists, even when the email fails.
 * - Sign-in: a missing account costs the same password work as a real one;
 *   a per-account limit stands beside the per-IP one.
 * - Passwords: one bcrypt cost everywhere, and at most 72 bytes.
 * - /api/health never returns the database's own error text.
 *
 * Behavioural for the reset request and the password rule; structural
 * (reads the source) for the rest.
 */
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/* ------------------------------------------------------------------ */
/* Admin pages                                                         */
/* ------------------------------------------------------------------ */

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(resolve(ROOT, rel)).isDirectory()) out.push(...pagesUnder(rel));
    else if (name === "page.tsx") out.push(rel);
  }
  return out;
}

describe("Founder Dashboard pages", () => {
  const pages = pagesUnder("app/dashboard/admin");

  test("there are admin pages to check", () => {
    assert.ok(pages.length >= 5, pages.join(", "));
  });

  for (const page of pages) {
    test(`${page}: checks admin access itself, before any data, or is a client page`, () => {
      const src = strip(read(page));
      if (/^\s*["']use client["']/.test(read(page))) {
        // A client page renders nothing secret itself; its data comes from
        // /api/admin/*, where every handler checks admin access.
        assert.ok(!/from "@\/lib\/prisma"/.test(src), "a client page never imports the database");
        return;
      }
      const body = src.slice(src.indexOf("export default async function"));
      const check = Math.max(body.indexOf("await requireAdminPage()"), body.indexOf("isAdminEmail("));
      assert.ok(check > 0, `${relative(ROOT, resolve(ROOT, page))} has no admin check of its own`);
      for (const data of ["prisma.", "getFounderStats(", "getStoresDirectory(", "getProductsDirectory(", "getAdminProductPreview("]) {
        const at = body.indexOf(data);
        if (at !== -1) assert.ok(check < at, `${data} is read before the admin check`);
      }
    });
  }

  test("the shared guard redirects the signed-out and non-admins", () => {
    const guard = strip(read("lib/admin-page-guard.ts"));
    assert.match(guard, /const session = await getServerSession\(authOptions\);/);
    assert.match(guard, /if \(!email\) redirect\("\/login"\);/);
    assert.match(guard, /if \(!isAdminEmail\(email\)\) redirect\("\/dashboard"\);/);
    assert.match(strip(read("app/dashboard/admin/layout.tsx")), /await requireAdminPage\(\);\s*return <>\{children\}<\/>;/);
  });
});

/* ------------------------------------------------------------------ */
/* Password reset request                                              */
/* ------------------------------------------------------------------ */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const users: Array<{ id: string; email: string; resetToken: string | null; resetTokenExpiry: Date | null }> = [];
const sentEmails: Array<{ to: string; html: string }> = [];
let sendFails = false;
let POST: (req: Request) => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          findFirst: async ({ where }: { where: { email: { equals: string } } }) =>
            users.find((u) => u.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null,
          update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = users.find((u) => u.id === where.id)!;
            Object.assign(row, data);
            return row;
          },
        },
      },
    },
  });
  mock.module("@/lib/rate-limit", {
    namedExports: {
      getClientIp: () => "10.0.0.1",
      rateLimiters: { passwordReset: () => ({ success: true, remaining: 2, resetTime: Date.now() + 1000 }) },
    },
  });
  mock.module("@/lib/after-response", {
    namedExports: { runAfterResponse: async (task: () => Promise<unknown>) => { await task(); return "inline"; } },
  });
  mock.module("resend", {
    namedExports: {
      Resend: class {
        emails = {
          send: async (msg: { to: string; html: string }) => {
            if (sendFails) return { error: { name: "validation_error", message: `cannot send to ${msg.to}` } };
            sentEmails.push(msg);
            return { error: null };
          },
        };
      },
    },
  });
  for (const level of ["log", "warn", "error"] as const) console[level] = () => {};
  POST = (await import("../app/api/auth/forgot-password/route.ts")).POST as typeof POST;
});

beforeEach(() => {
  users.length = 0;
  users.push({ id: "u1", email: "maha@example.com", resetToken: null, resetTokenExpiry: null });
  sentEmails.length = 0;
  sendFails = false;
});

const ask = async (email: string) => {
  const res = await POST(new Request("https://saiflow.test/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("password reset request", () => {
  test("the link goes to the address stored on the account, not the one typed in", async () => {
    const res = await ask("MAHA@Example.com");
    assert.equal(res.status, 200);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "maha@example.com");
  });

  test("only the token's hash is stored; the raw token travels only in the link", async () => {
    await ask("maha@example.com");
    const raw = /reset-password\?token=([0-9a-f]{64})/.exec(sentEmails[0].html)?.[1];
    assert.ok(raw, "the link carries a 64-hex token");
    assert.equal(users[0].resetToken, sha256(raw!));
    assert.notEqual(users[0].resetToken, raw);
    assert.ok(users[0].resetTokenExpiry! > new Date());
  });

  test("the reply is the same for an unknown address, a known one, and a failed send", async () => {
    const known = await ask("maha@example.com");
    const unknown = await ask("nobody@example.com");
    sendFails = true;
    const failed = await ask("maha@example.com");
    for (const res of [known, unknown, failed]) {
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { message: "If an account exists, we've sent a reset link to your email" });
    }
    assert.equal(sentEmails.length, 1, "nothing is sent for the unknown address");
  });

  test("the email is sent after the reply, and its failure is logged by name only", () => {
    const src = strip(read("app/api/auth/forgot-password/route.ts"));
    assert.match(src, /await runAfterResponse\(async \(\) => \{/);
    assert.match(src, /to,\s*subject:/);
    assert.ok(!/to: email/.test(src), "never the typed address");
    assert.match(src, /console\.error\("\[forgot-password\] reset email failed", emailError\.name \?\? "Error"\)/);
  });
});

/* ------------------------------------------------------------------ */
/* Reset, sign-in, passwords, health                                   */
/* ------------------------------------------------------------------ */

describe("the rest of the account flow", () => {
  test("a reset looks up the token's hash and uses it once", () => {
    const src = strip(read("app/api/auth/reset-password/route.ts"));
    assert.match(src, /const tokenHash = hashToken\(token\);/);
    assert.match(src, /where: \{ resetToken: tokenHash \}/);
    assert.match(src, /updateMany\(\{\s*where: \{ id: user\.id, resetToken: tokenHash, resetTokenExpiry: \{ gt: new Date\(\) \} \}/);
    assert.match(src, /if \(used\.count !== 1\)/);
  });

  test("sign-in: a missing account costs the same work, and failed attempts are limited per account", () => {
    const src = strip(read("app/api/auth/authOptions.ts"));
    assert.match(src, /if \(loginFailures\.blocked\(credentials\.email, ip\)\)/);
    assert.match(src, /if \(!user \|\| !user\.password\) \{\s*await burnPasswordCheck\(credentials\.password\);\s*loginFailures\.record\(credentials\.email, ip\);\s*throw new Error\(GENERIC\);/);
    assert.match(src, /if \(!valid\) \{\s*loginFailures\.record\(credentials\.email, ip\);\s*throw new Error\(GENERIC\);/);
    // A correct password is never counted.
    const afterValid = src.slice(src.indexOf("if (!valid) {"));
    assert.equal((afterValid.match(/loginFailures\.record/g) ?? []).length, 1);
  });

  test("the dummy check is a fixed cost-10 hash, made once, never per call", () => {
    const src = read("lib/auth/password.ts");
    assert.match(src, /const DUMMY_HASH = "\$2b\$10\$[A-Za-z0-9./]{53}";/);
    assert.match(strip(src), /await bcrypt\.compare\(password, DUMMY_HASH\);/);
  });

  test("one bcrypt cost everywhere", async () => {
    const { BCRYPT_ROUNDS } = await import("../lib/auth/password.ts");
    assert.equal(BCRYPT_ROUNDS, 12);
    assert.match(strip(read("app/api/signup/route.ts")), /await hashPassword\(password\)/);
    assert.match(strip(read("app/api/auth/reset-password/route.ts")), /await hashPassword\(password\)/);
    assert.match(strip(read("lib/auth/email-verification.ts")), /bcrypt\.hash\(randomBytes\(32\)\.toString\("hex"\), BCRYPT_ROUNDS\)/);
    for (const file of ["app/api/signup/route.ts", "app/api/auth/reset-password/route.ts", "lib/auth/email-verification.ts"]) {
      assert.ok(!/bcrypt\.hash\([^)]*,\s*10\)/.test(read(file)), file);
    }
  });

  test("passwords are at most 72 bytes, counted in bytes", async () => {
    const { signupSchema, resetPasswordSchema } = await import("../lib/validations.ts");
    // Each password also meets the existing rule: a lowercase, an uppercase and a digit.
    const ok = { name: "Maha", email: "maha@example.com", password: "Aa1" + "a".repeat(69) };
    assert.equal(signupSchema.safeParse(ok).success, true, "72 bytes");
    assert.equal(signupSchema.safeParse({ ...ok, password: "Aa1" + "a".repeat(70) }).success, false, "73 bytes");
    assert.equal(signupSchema.safeParse({ ...ok, password: "Aa1" + "س".repeat(34) }).success, true, "37 characters, 71 bytes");
    assert.equal(signupSchema.safeParse({ ...ok, password: "Aa1" + "س".repeat(35) }).success, false, "38 characters, 73 bytes");
    assert.equal(resetPasswordSchema.safeParse({ token: "t", password: "Aa1" + "a".repeat(70) }).success, false);
  });

  test("the public health check never returns the database's error text", () => {
    const src = strip(read("app/api/health/route.ts"));
    assert.match(src, /health\.checks\.database\.error = "unavailable";/);
    assert.ok(!/error\.message/.test(src));
  });

  test(".gitignore keeps every .env file out except the template", () => {
    const ignore = read(".gitignore");
    assert.match(ignore, /^\.env\*$/m);
    assert.match(ignore, /^!\.env\.example$/m);
  });
});
