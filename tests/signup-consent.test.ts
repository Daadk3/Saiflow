/**
 * Sign-up consent, the policy version it records, and the self-hosted font.
 *
 * The signup route itself is exercised in auth-email-verification.test.ts
 * (it needs that file's in-memory database). This file covers the cookie the
 * Google callback trusts, the legal copy, and the font links.
 */

import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

type ConsentMod = typeof import("../lib/signup-consent.ts");
type PolicyMod = typeof import("../lib/policy.ts");
let consent: ConsentMod;
let policy: PolicyMod;
let googleConsentRoute: { POST: (req: Request) => Promise<Response> };

before(async () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-not-a-real-key";
  mock.module("@/lib/rate-limit", {
    namedExports: {
      getClientIp: () => "127.0.0.1",
      rateLimiters: {
        auth: () => ({ success: true, remaining: 4, resetTime: Date.now() + 60_000 }),
      },
    },
  });
  policy = await import("../lib/policy.ts");
  consent = await import("../lib/signup-consent.ts");
  googleConsentRoute = await import("../app/api/signup/google-consent/route.ts");
});

function post(body: unknown): Request {
  return new Request("https://saiflow.test/api/signup/google-consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("policy version", () => {
  test("the version is the date these documents changed, and the page date comes from it", () => {
    assert.equal(policy.POLICY_VERSION, "2026-11-24");
    assert.equal(policy.policyUpdatedOn(), "November 24, 2026");
    for (const file of ["app/privacy/page.tsx", "app/terms/page.tsx"]) {
      const src = read(file);
      assert.match(src, /policyUpdatedOn\(\)/, file);
      assert.ok(!src.includes("July 2026"), file);
    }
  });
});

describe("privacy and terms copy", () => {
  test("section 4 names each processor and the verified regions, and drops the old US claims", () => {
    const src = read("app/privacy/page.tsx");
    for (const fact of [
      "iad1",
      "Washington, DC area, United States",
      "eu-central-1",
      "Frankfurt, Germany",
      "ap-northeast-1",
      "Tokyo, Japan",
      "UploadThing (United States)",
      "Cloudmersive",
      "Geidea (Saudi Arabia)",
      "under its own privacy policy",
      "PayPal",
      "OpenAI or Anthropic, both in the United States",
      "does not state which of the two is configured",
      "not loaded from Google",
    ]) {
      assert.ok(src.includes(fact), fact);
    }
    assert.ok(!src.includes("hosted on infrastructure located in the United States"));
    assert.ok(!src.includes("Resend (United States)"));
    assert.ok(!/under the age of 13|under 13/.test(src));
    assert.match(src, /at least 18 years old/);
  });

  test("the terms require 18 or older", () => {
    const src = read("app/terms/page.tsx");
    assert.match(src, /at least 18 years old to create an account or use the Service/);
    assert.match(src, /confirm that you are 18 or older/);
  });

  test("both sign-up languages ask for the terms and for 18+", () => {
    for (const locale of ["en", "ar"]) {
      const signup = JSON.parse(read(`messages/${locale}.json`)).auth.signup;
      assert.match(signup.agreeTerms, locale === "ar" ? /شروط الخدمة/ : /Terms of Service/);
      assert.match(signup.agreeTerms, locale === "ar" ? /سياسة الخصوصية/ : /Privacy Policy/);
      assert.match(signup.confirmAge, /18/);
      assert.ok(signup.consentRequired && signup.googleConsentRequired, locale);
    }
    const page = read("components/auth/SignupForm.tsx");
    assert.match(page, /id="accept-terms"/);
    assert.match(page, /id="confirm-age"/);
    assert.equal((page.match(/type="checkbox"/g) ?? []).length, 2);
    assert.match(page, /useState\(false\)/);
    assert.match(page, /\/api\/signup\/google-consent/);
    assert.match(page, /acceptedTerms: true/);
    assert.match(page, /acceptedAge: true/);
  });
});

describe("signup consent cookie", () => {
  test("a fresh token verifies, and a tampered or expired one does not", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    const token = consent.signSignupConsent(now);
    assert.equal(consent.verifySignupConsent(token, now + 1000), true);
    assert.equal(consent.verifySignupConsent(token, now + consent.SIGNUP_CONSENT_MAX_AGE_SECONDS * 1000), false);
    assert.equal(consent.verifySignupConsent(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), now), false);
    assert.equal(consent.verifySignupConsent(undefined, now), false);
    assert.equal(consent.verifySignupConsent("not-a-token", now), false);
  });

  test("outside a request, consent is refused so a new Google account is not created", async () => {
    assert.equal(await consent.consumeSignupConsent(), false);
  });

  test("the cookie route sets an httpOnly cookie only when both flags are true", async () => {
    const refused = await googleConsentRoute.POST(post({ acceptedTerms: true, acceptedAge: false }));
    assert.equal(refused.status, 400);
    assert.equal(refused.headers.get("set-cookie"), null);

    const missing = await googleConsentRoute.POST(post({ acceptedAge: true }));
    assert.equal(missing.status, 400);

    const ok = await googleConsentRoute.POST(post({ acceptedTerms: true, acceptedAge: true }));
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${consent.SIGNUP_CONSENT_COOKIE}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /samesite=lax/i);
    assert.match(setCookie, /Path=\//);
    const value = /sf_signup_consent=([^;]+)/.exec(setCookie)?.[1];
    assert.equal(consent.verifySignupConsent(value), true);
  });
});

describe("Cairo is self-hosted", () => {
  test("the root layout uses next/font and no file links the Google font hosts", () => {
    const layout = read("app/layout.tsx");
    assert.match(layout, /from "next\/font\/google"/);
    assert.match(layout, /subsets:\s*\[[^\]]*"/);
    assert.match(layout, /"arabic"/);
    assert.match(layout, /"latin"/);
    assert.match(layout, /cairo\.className/);
    assert.ok(!layout.includes("preconnect"));

    const skip = new Set(["node_modules", ".next", ".git"]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(tsx?|jsx?|css|html|md|json|mjs)$/.test(entry.name)) continue;
        const text = readFileSync(path, "utf8");
        // Built from parts so this file does not itself contain the host names.
        const googleFonts = ["fonts", "googleapis", "com"].join(".");
        const gstatic = ["fonts", "gstatic", "com"].join(".");
        if (text.includes(googleFonts) || text.includes(gstatic)) {
          hits.push(relative(ROOT, path));
        }
      }
    };
    walk(ROOT);
    assert.deepEqual(hits, []);
  });
});
