/**
 * Email verification and session revocation.
 *
 * The property under test: a session can only ever belong to someone who has
 * proved they own its email address. Every ownership and admin check in the
 * app reads the session email, so these tests are about the identity those
 * checks stand on, and about the squatter in particular: someone who
 * registered an address they do not own.
 *
 * Runs the real modules (token handling, the session guard, the NextAuth
 * callbacks and the four routes) against an in-memory database. No network,
 * no email provider, no real database.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/* ------------------------------------------------------------------ */
/* In-memory database                                                  */
/* ------------------------------------------------------------------ */

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  password: string;
  emailVerified: Date | null;
  resetToken: string | null;
  resetTokenExpiry: Date | null;
}
interface TokenRow {
  identifier: string;
  token: string;
  expires: Date;
}

const db = {
  users: new Map<string, UserRow>(),
  tokens: new Map<string, TokenRow>(),
  queries: 0,
  nextId: 1,
};

function pick<T extends object>(row: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) return { ...row };
  const out: Partial<T> = {};
  for (const [k, on] of Object.entries(select)) if (on) (out as Record<string, unknown>)[k] = (row as Record<string, unknown>)[k];
  return out;
}

const prismaMock = {
  user: {
    findUnique: async ({ where, select }: { where: { id?: string; resetToken?: string }; select?: Record<string, boolean> }) => {
      db.queries++;
      let row: UserRow | undefined;
      if (where.id !== undefined) row = db.users.get(where.id);
      else if (where.resetToken !== undefined) row = [...db.users.values()].find((u) => u.resetToken === where.resetToken);
      return row ? pick(row, select) : null;
    },
    findFirst: async ({ where, select }: { where: { email: { equals: string } }; select?: Record<string, boolean> }) => {
      db.queries++;
      const wanted = where.email.equals.toLowerCase();
      const row = [...db.users.values()].find((u) => u.email.toLowerCase() === wanted);
      return row ? pick(row, select) : null;
    },
    create: async ({ data, select }: { data: Partial<UserRow> & { email: string; password: string }; select?: Record<string, boolean> }) => {
      db.queries++;
      const row: UserRow = {
        id: `user_${db.nextId++}`,
        name: null,
        image: null,
        emailVerified: null,
        resetToken: null,
        resetTokenExpiry: null,
        ...data,
      };
      db.users.set(row.id, row);
      return pick(row, select);
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
      db.queries++;
      const row = db.users.get(where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return { ...row };
    },
  },
  verificationToken: {
    findUnique: async ({ where }: { where: { token: string } }) => {
      db.queries++;
      const row = db.tokens.get(where.token);
      return row ? { ...row } : null;
    },
    create: async ({ data }: { data: TokenRow }) => {
      db.queries++;
      db.tokens.set(data.token, { ...data });
      return { ...data };
    },
    deleteMany: async ({ where }: { where: { token?: string; identifier?: { startsWith: string } } }) => {
      db.queries++;
      let count = 0;
      for (const [key, row] of db.tokens) {
        const hit =
          (where.token !== undefined && row.token === where.token) ||
          (where.identifier !== undefined && row.identifier.startsWith(where.identifier.startsWith));
        if (hit) {
          db.tokens.delete(key);
          count++;
        }
      }
      return { count };
    },
  },
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
};

const sent: Array<{ to: string; url: string }> = [];

/**
 * lib/rate-limit.ts starts a module-level setInterval that would keep this
 * test process alive forever, so it is replaced, as in the other route tests.
 * Unlike those, the limits are part of what is tested here, so this is the
 * same fixed-window counter with the same budgets, minus the timer.
 */
const limitStore = new Map<string, { count: number; resetTime: number }>();
function rateLimitFake(identifier: string, config: { windowMs: number; maxRequests: number }) {
  const now = Date.now();
  const entry = limitStore.get(identifier);
  if (!entry || entry.resetTime < now) {
    limitStore.set(identifier, { count: 1, resetTime: now + config.windowMs });
    return { success: true, remaining: config.maxRequests - 1, resetTime: now + config.windowMs };
  }
  entry.count++;
  return { success: entry.count <= config.maxRequests, remaining: Math.max(0, config.maxRequests - entry.count), resetTime: entry.resetTime };
}
const rateLimitMock = {
  rateLimit: rateLimitFake,
  getClientIp: (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown",
  rateLimiters: {
    auth: (ip: string) => rateLimitFake(`auth:${ip}`, { windowMs: 60_000, maxRequests: 5 }),
    signup: (ip: string) => rateLimitFake(`signup:${ip}`, { windowMs: 3_600_000, maxRequests: 3 }),
    passwordReset: (ip: string) => rateLimitFake(`password-reset:${ip}`, { windowMs: 3_600_000, maxRequests: 3 }),
    api: (ip: string) => rateLimitFake(`api:${ip}`, { windowMs: 60_000, maxRequests: 100 }),
  },
};

/* ------------------------------------------------------------------ */
/* Modules under test, loaded behind the mocks                          */
/* ------------------------------------------------------------------ */

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let verification: Mod;
let guard: Mod;
let authOptions: Mod;
let signupRoute: Mod;
let verifyRoute: Mod;
let resendRoute: Mod;
let resetRoute: Mod;

before(async () => {
  process.env.ADMIN_EMAILS = "founder@saiflow.test";

  mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });
  mock.module("@/lib/rate-limit", { namedExports: rateLimitMock });
  mock.module("@/lib/email", {
    namedExports: {
      sendVerificationEmail: async (msg: { to: string; url: string }) => {
        sent.push(msg);
        return true;
      },
    },
  });
  // authOptions imports a type from "next-auth" by name, and builds its
  // providers at import. The providers are replaced by their own options so
  // the credentials `authorize` can be called directly.
  mock.module("next-auth", { namedExports: { NextAuthOptions: undefined } });
  mock.module("next-auth/providers/google", { defaultExport: (opts: object) => ({ id: "google", ...opts }) });
  mock.module("next-auth/providers/credentials", { defaultExport: (opts: object) => ({ id: "credentials", ...opts }) });

  verification = await import("../lib/auth/email-verification.ts");
  guard = await import("../lib/auth/session-guard.ts");
  authOptions = (await import("../app/api/auth/authOptions.ts")).authOptions;
  signupRoute = await import("../app/api/signup/route.ts");
  verifyRoute = await import("../app/api/auth/verify-email/route.ts");
  resendRoute = await import("../app/api/auth/verify-email/resend/route.ts");
  resetRoute = await import("../app/api/auth/reset-password/route.ts");
});

beforeEach(() => {
  limitStore.clear();
  db.users.clear();
  db.tokens.clear();
  db.queries = 0;
  sent.length = 0;
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let ipCounter = 0;
/** A fresh client IP per request, so the in-memory rate limits never interfere. */
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

function post(path: string, body: unknown, ip = freshIp()): Request {
  return new Request(`https://saiflow.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function addUser(email: string, password: string, verified: boolean): Promise<UserRow> {
  const row = (await prismaMock.user.create({
    data: { email, password: await bcrypt.hash(password, 4), emailVerified: verified ? new Date() : null },
  })) as UserRow;
  return db.users.get(row.id)!;
}

const tokenFromUrl = (url: string) => new URL(url).searchParams.get("token")!;

/** The token NextAuth would hold after a successful sign-in. */
async function signInToken(user: UserRow) {
  return authOptions.callbacks.jwt({ token: { email: user.email }, user: { id: user.id, email: user.email } });
}

function authorize(email: string, password: string) {
  const credentials = authOptions.providers.find((p: Mod) => p.id === "credentials");
  return credentials.authorize({ email, password }, { headers: { "x-forwarded-for": freshIp() } });
}

function googleSignIn(email: string, emailVerified: unknown) {
  const user: Mod = { id: "google-sub-123", email, name: "Google User", image: null };
  return authOptions.callbacks
    .signIn({ user, account: { provider: "google" }, profile: { email, email_verified: emailVerified } })
    .then((ok: boolean) => ({ ok, user }));
}

/* ------------------------------------------------------------------ */
/* 1. Verification tokens                                              */
/* ------------------------------------------------------------------ */

describe("verification tokens", () => {
  test("only a hash is stored, bound to the account and its address", async () => {
    const user = await addUser("maha@example.com", "Secret123", false);
    const raw = await verification.issueVerificationToken(user);

    assert.match(raw, /^[0-9a-f]{64}$/);
    assert.equal(db.tokens.size, 1);
    const [row] = [...db.tokens.values()];
    assert.notEqual(row.token, raw, "the raw token is never stored");
    assert.equal(row.token, verification.hashToken(raw));
    assert.equal(row.identifier, `email-verify:${user.id}:maha@example.com`);
    assert.ok(row.expires.getTime() > Date.now() + 23 * 60 * 60 * 1000);
  });

  test("issuing a new token revokes the previous one", async () => {
    const user = await addUser("maha@example.com", "Secret123", false);
    const first = await verification.issueVerificationToken(user);
    const second = await verification.issueVerificationToken(user);

    assert.equal(db.tokens.size, 1);
    assert.equal(await verification.verifyEmailWithToken({ token: first, password: "Secret123" }), "invalid");
    assert.equal(await verification.verifyEmailWithToken({ token: second, password: "Secret123" }), "verified");
  });

  test("token plus password verifies, once", async () => {
    const user = await addUser("maha@example.com", "Secret123", false);
    const raw = await verification.issueVerificationToken(user);

    assert.equal(await verification.verifyEmailWithToken({ token: raw, password: "Secret123" }), "verified");
    assert.ok(db.users.get(user.id)!.emailVerified instanceof Date);
    assert.equal(db.tokens.size, 0, "the token is consumed");
    assert.equal(await verification.verifyEmailWithToken({ token: raw, password: "Secret123" }), "invalid");
  });

  test("the token alone is not enough: a wrong password verifies nothing and keeps the link usable", async () => {
    // The squatter case: the real owner clicks a link for an account someone
    // else created. Without the squatter's password, nothing is confirmed.
    const user = await addUser("victim@example.com", "SquatterChose1", false);
    const raw = await verification.issueVerificationToken(user);

    assert.equal(await verification.verifyEmailWithToken({ token: raw, password: "" }), "wrong_password");
    assert.equal(await verification.verifyEmailWithToken({ token: raw, password: "Guess1234" }), "wrong_password");
    assert.equal(db.users.get(user.id)!.emailVerified, null);
    assert.equal(db.tokens.size, 1, "a typo does not burn the link");
  });

  test("an expired token is refused and removed", async () => {
    const user = await addUser("maha@example.com", "Secret123", false);
    const raw = await verification.issueVerificationToken(user);
    [...db.tokens.values()][0].expires = new Date(Date.now() - 1000);

    assert.equal(await verification.verifyEmailWithToken({ token: raw, password: "Secret123" }), "expired");
    assert.equal(db.tokens.size, 0);
    assert.equal(db.users.get(user.id)!.emailVerified, null);
  });

  test("a malformed token is refused before any database read", async () => {
    for (const token of [undefined, null, 42, "", "abc", "z".repeat(64), "A".repeat(64)]) {
      db.queries = 0;
      assert.equal(await verification.verifyEmailWithToken({ token, password: "x" }), "invalid");
      assert.equal(db.queries, 0, `queried for ${String(token)}`);
    }
  });

  test("a token cannot verify an address it was not sent to", async () => {
    const user = await addUser("old@example.com", "Secret123", false);
    const raw = await verification.issueVerificationToken(user);
    db.users.get(user.id)!.email = "new@example.com";

    assert.equal(await verification.verifyEmailWithToken({ token: raw, password: "Secret123" }), "invalid");
    assert.equal(db.users.get(user.id)!.emailVerified, null);
  });

  test("links point at a fixed origin, never at the request", () => {
    const saved = { env: process.env.VERCEL_ENV, url: process.env.VERCEL_URL, nextauth: process.env.NEXTAUTH_URL };
    try {
      process.env.VERCEL_ENV = "production";
      process.env.VERCEL_URL = "evil.example";
      assert.equal(verification.verificationEmailOrigin(), "https://www.saiflow.io");

      process.env.VERCEL_ENV = "preview";
      process.env.VERCEL_URL = "my-gumroad-abc123.vercel.app";
      assert.equal(verification.verificationEmailOrigin(), "https://my-gumroad-abc123.vercel.app");

      delete process.env.VERCEL_ENV;
      process.env.NEXTAUTH_URL = "http://localhost:3100/";
      assert.equal(verification.verificationEmailOrigin(), "http://localhost:3100");
      assert.equal(verification.verificationEmailOrigin.length, 0, "takes no request input");
    } finally {
      for (const [k, v] of [["VERCEL_ENV", saved.env], ["VERCEL_URL", saved.url], ["NEXTAUTH_URL", saved.nextauth]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. Sessions                                                         */
/* ------------------------------------------------------------------ */

describe("sessions are honoured only for verified, unchanged accounts", () => {
  test("sign-in binds the token to the account and its current password", async () => {
    const user = await addUser("Maha@Example.com", "Secret123", true);
    const token = await signInToken(user);

    assert.equal(token.id, user.id);
    assert.equal(token.email, "Maha@Example.com", "the stored address, not the provider's spelling");
    assert.equal(token.cv, verification.credentialFingerprint(user.password));
    // A later request with the same token passes.
    assert.deepEqual(await authOptions.callbacks.jwt({ token }), token);
  });

  const revoked = (reason: string) => (err: unknown) =>
    err instanceof guard.SessionRevokedError && (err as Mod).reason === reason;

  test("an unverified account's session is refused", async () => {
    const user = await addUser("maha@example.com", "Secret123", true);
    const token = await signInToken(user);
    db.users.get(user.id)!.emailVerified = null;
    await assert.rejects(authOptions.callbacks.jwt({ token }), revoked("unverified"));
  });

  test("a password change ends every session opened with the old password", async () => {
    const user = await addUser("maha@example.com", "Secret123", true);
    const token = await signInToken(user);
    db.users.get(user.id)!.password = await bcrypt.hash("NewSecret456", 4);
    await assert.rejects(authOptions.callbacks.jwt({ token }), revoked("credentials_changed"));
  });

  test("tokens issued before this change carry no fingerprint and are refused", async () => {
    const user = await addUser("maha@example.com", "Secret123", true);
    await assert.rejects(authOptions.callbacks.jwt({ token: { id: user.id, email: user.email } }), revoked("credentials_changed"));
  });

  test("a deleted account, a missing id or a changed email is refused", async () => {
    const user = await addUser("maha@example.com", "Secret123", true);
    const token = await signInToken(user);

    await assert.rejects(authOptions.callbacks.jwt({ token: { ...token, id: undefined } }), revoked("no_account"));
    await assert.rejects(authOptions.callbacks.jwt({ token: { ...token, email: "other@example.com" } }), revoked("email_changed"));
    db.users.delete(user.id);
    await assert.rejects(authOptions.callbacks.jwt({ token }), revoked("account_missing"));
  });

  test("the session exposes the stored address, and admin only for a listed one", async () => {
    const founder = await addUser("founder@saiflow.test", "Secret123", true);
    const token = await signInToken(founder);
    const session = await authOptions.callbacks.session({ session: { user: { email: "FOUNDER@saiflow.test" } }, token });
    assert.equal(session.user.email, "founder@saiflow.test");
    assert.equal(session.user.id, founder.id);
    assert.equal(session.user.isAdmin, true);
  });

  test("NextAuth clears the session when the jwt callback throws", () => {
    // The revocation relies on this behaviour of next-auth 4: an exception in
    // the jwt callback logs JWT_SESSION_ERROR and pushes cleared cookies.
    const src = read("node_modules/next-auth/core/routes/session.js");
    assert.match(src, /logger\.error\("JWT_SESSION_ERROR", error\);\s*[\s\S]{0,200}sessionStore\.clean\(\)/);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Password sign-in                                                 */
/* ------------------------------------------------------------------ */

describe("password sign-in", () => {
  test("an unverified account cannot sign in, and is told why only after the right password", async () => {
    await addUser("maha@example.com", "Secret123", false);

    await assert.rejects(authorize("maha@example.com", "WrongPass1"), { message: "Invalid email or password" });
    await assert.rejects(authorize("maha@example.com", "Secret123"), { message: "EMAIL_NOT_VERIFIED" });
  });

  test("a verified account signs in", async () => {
    const user = await addUser("maha@example.com", "Secret123", true);
    const result = await authorize("MAHA@example.com", "Secret123");
    assert.equal(result.id, user.id);
  });

  test("the browser and the server share the same error code", () => {
    assert.match(read("lib/auth/errors.ts"), /EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED"/);
    assert.match(read("app/login/page.tsx"), /result\?\.error === EMAIL_NOT_VERIFIED/);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Google sign-in                                                   */
/* ------------------------------------------------------------------ */

describe("Google sign-in", () => {
  test("an address Google has not verified is refused, with no account created", async () => {
    for (const flag of [false, undefined, "true"]) {
      const { ok } = await googleSignIn("new@gmail.com", flag);
      assert.equal(ok, false, `email_verified=${String(flag)}`);
    }
    assert.equal(db.users.size, 0);
  });

  test("a new Google user is created verified, with a password nobody knows", async () => {
    const { ok, user } = await googleSignIn("New@Gmail.com", true);
    assert.equal(ok, true);
    const row = db.users.get(user.id)!;
    assert.equal(row.email, "new@gmail.com");
    assert.ok(row.emailVerified instanceof Date);
    assert.match(row.password, /^\$2[aby]\$/);
    assert.ok(!read("app/api/auth/authOptions.ts").includes("oauth-${"), "the guessable placeholder is gone");
  });

  test("Google reclaims an address a squatter registered: their password and sessions stop working", async () => {
    const squatted = await addUser("victim@gmail.com", "SquatterChose1", false);
    // Pretend the squatter somehow held a session (e.g. from before this change).
    db.users.get(squatted.id)!.emailVerified = new Date();
    const squatterToken = await signInToken(squatted);
    db.users.get(squatted.id)!.emailVerified = null;

    const { ok, user } = await googleSignIn("victim@gmail.com", true);
    assert.equal(ok, true);
    assert.equal(user.id, squatted.id, "the real owner gets the account");

    const row = db.users.get(squatted.id)!;
    assert.ok(row.emailVerified instanceof Date);
    assert.equal(await bcrypt.compare("SquatterChose1", row.password), false, "the squatter's password no longer works");
    await assert.rejects(authOptions.callbacks.jwt({ token: squatterToken }), (e: unknown) => e instanceof guard.SessionRevokedError);
  });

  test("Google leaves a verified account's password alone", async () => {
    const owner = await addUser("owner@gmail.com", "OwnerChose1", true);
    const before = owner.password;
    const { ok } = await googleSignIn("owner@gmail.com", true);
    assert.equal(ok, true);
    assert.equal(db.users.get(owner.id)!.password, before);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Routes                                                           */
/* ------------------------------------------------------------------ */

describe("signup", () => {
  test("creates an unverified account and emails a link to that address", async () => {
    const res = await signupRoute.POST(post("/api/signup", { name: "Maha", email: "Maha@Example.com", password: "Secret123" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user, undefined, "no account details in the response");
    assert.equal(body.verificationEmailSent, true);

    const [row] = [...db.users.values()];
    assert.equal(row.email, "maha@example.com");
    assert.equal(row.emailVerified, null);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "maha@example.com");
    assert.match(sent[0].url, /\/verify-email\?token=[0-9a-f]{64}$/);
    assert.equal(db.tokens.get(verification.hashToken(tokenFromUrl(sent[0].url)))?.identifier.startsWith(`email-verify:${row.id}:`), true);
  });

  test("the new account cannot sign in until it is verified, then can", async () => {
    await signupRoute.POST(post("/api/signup", { name: "Maha", email: "maha@example.com", password: "Secret123" }));
    await assert.rejects(authorize("maha@example.com", "Secret123"), { message: "EMAIL_NOT_VERIFIED" });

    const res = await verifyRoute.POST(post("/api/auth/verify-email", { token: tokenFromUrl(sent[0].url), password: "Secret123" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "verified" });

    const signedIn = await authorize("maha@example.com", "Secret123");
    assert.equal(typeof signedIn.id, "string");
  });
});

describe("verify-email route", () => {
  test("reports wrong password, invalid and expired as distinct 400s", async () => {
    const user = await addUser("maha@example.com", "Secret123", false);
    const raw = await verification.issueVerificationToken(user);

    const wrong = await verifyRoute.POST(post("/api/auth/verify-email", { token: raw, password: "Nope1234" }));
    assert.equal(wrong.status, 400);
    assert.deepEqual(await wrong.json(), { error: "wrong_password" });

    const bad = await verifyRoute.POST(post("/api/auth/verify-email", { token: "f".repeat(64), password: "Secret123" }));
    assert.deepEqual(await bad.json(), { error: "invalid" });

    [...db.tokens.values()][0].expires = new Date(0);
    const expired = await verifyRoute.POST(post("/api/auth/verify-email", { token: raw, password: "Secret123" }));
    assert.deepEqual(await expired.json(), { error: "expired" });
  });

  test("the fake limiter uses the real sign-in budget", () => {
    assert.match(read("lib/rate-limit.ts"), /rateLimit\(`auth:\$\{ip\}`, \{ windowMs: 60 \* 1000, maxRequests: 5 \}\)/);
  });

  test("password guessing is rate-limited per IP", async () => {
    const user = await addUser("maha@example.com", "Secret123", false);
    const raw = await verification.issueVerificationToken(user);
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await verifyRoute.POST(post("/api/auth/verify-email", { token: raw, password: `Guess${i}xx` }, ip))).status);
    }
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
  });

  test("the link page only posts; opening it verifies nothing", () => {
    const page = read("app/verify-email/page.tsx");
    assert.match(page, /fetch\("\/api\/auth\/verify-email", \{\s*method: "POST"/);
    assert.match(page, /JSON\.stringify\(\{ token, password \}\)/);
    assert.ok(!/useEffect/.test(page), "nothing fires on page load");
  });
});

describe("resend route", () => {
  test("answers identically for unknown, unverified and verified addresses, sending only for unverified", async () => {
    await addUser("pending@example.com", "Secret123", false);
    await addUser("done@example.com", "Secret123", true);

    const bodies = [];
    for (const email of ["nobody@example.com", "pending@example.com", "done@example.com"]) {
      const res = await resendRoute.POST(post("/api/auth/verify-email/resend", { email }));
      assert.equal(res.status, 200);
      bodies.push(await res.json());
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
    assert.deepEqual(sent.map((m) => m.to), ["pending@example.com"]);
  });

  test("one address cannot be flooded from many IPs", async () => {
    await addUser("pending@example.com", "Secret123", false);
    for (let i = 0; i < 5; i++) {
      await resendRoute.POST(post("/api/auth/verify-email/resend", { email: "Pending@Example.com" }));
    }
    assert.equal(sent.length, 3);
  });
});

describe("password reset", () => {
  test("completing a reset verifies the address and ends the old password's sessions", async () => {
    const user = await addUser("victim@example.com", "SquatterChose1", false);
    db.users.get(user.id)!.emailVerified = new Date();
    const oldSession = await signInToken(user);
    Object.assign(db.users.get(user.id)!, {
      emailVerified: null,
      resetToken: "r".repeat(64),
      resetTokenExpiry: new Date(Date.now() + 60_000),
    });

    const res = await resetRoute.POST(post("/api/auth/reset-password", { token: "r".repeat(64), password: "OwnerChose9" }));
    assert.equal(res.status, 200);

    const row = db.users.get(user.id)!;
    assert.ok(row.emailVerified instanceof Date);
    assert.equal(await bcrypt.compare("OwnerChose9", row.password), true);
    await assert.rejects(authOptions.callbacks.jwt({ token: oldSession }), (e: unknown) => e instanceof guard.SessionRevokedError);
  });

  test("an already-verified date is kept", async () => {
    const user = await addUser("maha@example.com", "Secret123", true);
    const original = db.users.get(user.id)!.emailVerified;
    Object.assign(db.users.get(user.id)!, { resetToken: "s".repeat(64), resetTokenExpiry: new Date(Date.now() + 60_000) });

    await resetRoute.POST(post("/api/auth/reset-password", { token: "s".repeat(64), password: "NewSecret9" }));
    assert.equal(db.users.get(user.id)!.emailVerified, original);
  });
});
