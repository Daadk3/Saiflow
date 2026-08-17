/**
 * Stage E1 — the scheduled scanner, executed.
 *
 * These call the real exported `GET` and `POST` handlers with real Requests
 * and read real Responses, so a refusal here is a refusal the runtime
 * actually performs. Source-text assertions alone would only prove a guard
 * was typed, not that a request meets it.
 *
 * Mocked: next-auth's session, the auth options module (the real one pulls in
 * the Prisma adapter, bcrypt and env validation — none of it under test), the
 * scan provider's configured-check, and the pipeline itself. `isAdminEmail`
 * is REAL and reads a real ADMIN_EMAILS, because who counts as an admin is
 * precisely what one of these tests is about.
 *
 * `lib/scan/run.ts` is mocked rather than executed: E1 changed who may reach
 * the pipeline, not what the pipeline does. Its own behaviour stays covered
 * by tests/scan-pipeline.test.ts, which E1 does not touch.
 *
 * CRON_SECRET is set per-test to a value that exists only in this file. The
 * production secret is never read, needed, or referenced here.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ADMIN_EMAIL = "founder@saiflow.test";
const OTHER_EMAIL = "someone@example.test";

/** A throwaway token for this file only. Not a secret, and not the real one. */
const TEST_SECRET = "test-only-cron-token-not-a-real-secret";

const BATCH_KEYS = ["batchKeyAAAA1111", "batchKeyBBBB2222"];

process.env.ADMIN_EMAILS = ADMIN_EMAIL;

/* ------------------------------------------------------------------ */
/* Test doubles                                                        */
/* ------------------------------------------------------------------ */

const state: {
  session: unknown;
  configured: boolean;
  scanned: string[];
  findScannableCalls: number[];
} = {
  session: null,
  configured: true,
  scanned: [],
  findScannableCalls: [],
};

function reset() {
  state.session = null;
  state.configured = true;
  state.scanned = [];
  state.findScannableCalls = [];
  process.env.CRON_SECRET = TEST_SECRET;
}
reset();

let GET: (req: Request) => Promise<Response>;
let POST: (req: Request) => Promise<Response>;

before(async () => {
  mock.module("next-auth", {
    namedExports: { getServerSession: async () => state.session },
  });

  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, {
    namedExports: { authOptions: {} },
  });

  mock.module("@/lib/scan/cloudmersive", {
    namedExports: {
      cloudmersiveProvider: {
        id: "cloudmersive-test",
        isConfigured: () => state.configured,
      },
    },
  });

  mock.module("@/lib/scan/run", {
    namedExports: {
      findScannableKeys: async (limit: number) => {
        state.findScannableCalls.push(limit);
        return BATCH_KEYS;
      },
      scanFileAsset: async (key: string) => {
        state.scanned.push(key);
        return { key, outcome: "SAFE" };
      },
    },
  });

  const mod = await import("../app/api/internal/scan/route.ts");
  GET = mod.GET as typeof GET;
  POST = mod.POST as typeof POST;
});

beforeEach(reset);

/* ------------------------------------------------------------------ */
/* Request helpers                                                     */
/* ------------------------------------------------------------------ */

const URL_ = "https://saiflow.test/api/internal/scan";

function getReq(authorization?: string): Request {
  return new Request(URL_, {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });
}

function postReq(body?: unknown, authorization?: string): Request {
  return new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const asAdmin = () => ({ user: { email: ADMIN_EMAIL, id: "admin_1" } });
const asUser = () => ({ user: { email: OTHER_EMAIL, id: "user_1" } });
const bearer = (token = TEST_SECRET) => `Bearer ${token}`;

async function assertForbidden(res: Response) {
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "Forbidden");
  // A refusal must not report what would have happened.
  assert.equal(body.scanned, undefined);
  assert.equal(body.results, undefined);
  // Nothing ran.
  assert.deepEqual(state.scanned, []);
  assert.deepEqual(state.findScannableCalls, []);
}

/* ------------------------------------------------------------------ */
/* GET — the scheduled entry point                                     */
/* ------------------------------------------------------------------ */

describe("GET is reachable by Vercel Cron", () => {
  test("the correct bearer is authorised and scans the batch", async () => {
    const res = await GET(getReq(bearer()));
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.scanned, BATCH_KEYS.length);
    assert.deepEqual(state.scanned, BATCH_KEYS);
  });

  test("the route exports GET at all", () => {
    // Without this handler Vercel Cron — which issues a GET — would 405 on
    // every scheduled run, silently, forever. This is the regression that
    // would be easiest to reintroduce and hardest to notice.
    assert.equal(typeof GET, "function");
  });

  test("the batch is bounded", async () => {
    await GET(getReq(bearer()));
    assert.deepEqual(state.findScannableCalls, [5]);
  });
});

describe("GET fails closed", () => {
  test("a wrong bearer is refused", async () => {
    await assertForbidden(await GET(getReq(bearer("wrong-token"))));
  });

  test("no authorization header at all is refused", async () => {
    await assertForbidden(await GET(getReq()));
  });

  test("a bearer with the right value but wrong scheme is refused", async () => {
    await assertForbidden(await GET(getReq(`Token ${TEST_SECRET}`)));
  });

  test("the bare secret without the Bearer prefix is refused", async () => {
    await assertForbidden(await GET(getReq(TEST_SECRET)));
  });

  test("CRON_SECRET unset refuses even a well-formed bearer", async () => {
    delete process.env.CRON_SECRET;
    await assertForbidden(await GET(getReq(bearer())));
  });

  test("CRON_SECRET unset refuses an empty bearer", async () => {
    // The trap: `Bearer ${undefined}` must never equal an absent secret.
    delete process.env.CRON_SECRET;
    await assertForbidden(await GET(getReq("Bearer ")));
    await assertForbidden(await GET(getReq("Bearer undefined")));
  });

  test("a whitespace-only CRON_SECRET is treated as unset", async () => {
    process.env.CRON_SECRET = "   ";
    await assertForbidden(await GET(getReq("Bearer    ")));
    await assertForbidden(await GET(getReq("Bearer ")));
  });
});

describe("the bearer comparison is constant-time and never throws", () => {
  /**
   * `timingSafeEqual` raises a RangeError on buffers of unequal length. If the
   * length guard were ever dropped, that throw would be caught by the route's
   * catch and returned as 500 — an error where a refusal belongs, and a status
   * code that distinguishes "wrong length" from "wrong bytes", which is
   * precisely what a constant-time comparison exists to prevent.
   *
   * Every case below therefore asserts 403, never 500. A 500 is the regression
   * signal.
   */
  const lengths: [string, string][] = [
    ["one character", "x"],
    ["far shorter than the secret", "Bearer a"],
    ["one byte short", `Bearer ${TEST_SECRET.slice(0, -1)}`],
    ["one byte long", `Bearer ${TEST_SECRET}x`],
    ["far longer than the secret", `Bearer ${"z".repeat(4096)}`],
    ["empty string", ""],
  ];

  for (const [label, header] of lengths) {
    test(`a different-length token (${label}) is refused, not an error`, async () => {
      const res = await GET(getReq(header));
      assert.equal(res.status, 403, "must refuse, never 500");
      assert.equal((await res.json()).error, "Forbidden");
      assert.deepEqual(state.scanned, []);
    });
  }

  test("a WRONG token of exactly the right length is refused", async () => {
    // The case a length check alone would wave through, and the one
    // timingSafeEqual exists for: identical byte length, differing content.
    const wrong = `${TEST_SECRET.slice(0, -1)}X`;
    assert.equal(wrong.length, TEST_SECRET.length);
    assert.notEqual(wrong, TEST_SECRET);

    await assertForbidden(await GET(getReq(bearer(wrong))));
  });

  test("a token differing only in the FIRST byte is refused", async () => {
    const wrong = `X${TEST_SECRET.slice(1)}`;
    assert.equal(wrong.length, TEST_SECRET.length);
    await assertForbidden(await GET(getReq(bearer(wrong))));
  });

  test("a correct PREFIX of the secret is refused", async () => {
    // Rejects the "guess one byte at a time" attack shape directly.
    await assertForbidden(await GET(getReq(bearer(TEST_SECRET.slice(0, 10)))));
  });

  test("length is measured in BYTES, not characters", async () => {
    // A header value is a ByteString and cannot carry a code point above 255,
    // so multi-byte input can only ever reach this comparison from the SECRET
    // side — which is reachable, since CRON_SECRET is free text.
    //
    // "أبج" is 3 characters but 6 bytes. Against the header below the two
    // sides have the SAME character length (10) and DIFFERENT byte lengths
    // (10 vs 13). A guard written as `a.length !== b.length` on the strings
    // would judge them equal, hand two unequal buffers to timingSafeEqual, and
    // throw — surfacing as 500. Measuring bytes is what keeps this a 403.
    process.env.CRON_SECRET = "أبج";
    const expected = "Bearer أبج";
    const header = "Bearer abc";
    assert.equal(header.length, expected.length, "same character length");
    assert.notEqual(
      Buffer.byteLength(header, "utf8"),
      Buffer.byteLength(expected, "utf8"),
      "different byte length"
    );

    const res = await GET(getReq(header));
    assert.equal(res.status, 403, "must refuse, never 500");
    assert.deepEqual(state.scanned, []);
  });

  test("the exact token still succeeds", async () => {
    // Hardening that refuses everything is not hardening.
    const res = await GET(getReq(bearer()));
    assert.equal(res.status, 200);
    assert.deepEqual(state.scanned, BATCH_KEYS);
  });

  test("POST accepts the exact token and refuses a same-length wrong one", async () => {
    const ok = await POST(postReq({}, bearer()));
    assert.equal(ok.status, 200);

    reset();
    await assertForbidden(
      await POST(postReq({}, bearer(`${TEST_SECRET.slice(0, -1)}X`)))
    );
  });

  test("the comparison uses timingSafeEqual behind a length guard", () => {
    const code = stripComments(routeSrc);
    assert.ok(/from "node:crypto"/.test(code));
    assert.ok(/timingSafeEqual\(/.test(code));
    // The guard must precede the call, or the call throws.
    assert.ok(/\.length !== \w+\.length\) return false;/.test(code));
    // Plain === against the secret must be gone.
    assert.ok(!/header === `Bearer \$\{cronSecret\}`/.test(code));
  });
});

describe("GET does not accept ambient credentials (the CSRF property)", () => {
  test("a signed-in ADMIN with no bearer is refused", async () => {
    // This is the point of the whole design. A GET that honours a cookie can
    // be fired by any page an admin happens to load. It must fail even for a
    // real admin, so that a forged cross-site GET fails too.
    state.session = asAdmin();
    await assertForbidden(await GET(getReq()));
  });

  test("a signed-in admin with a WRONG bearer is still refused", async () => {
    state.session = asAdmin();
    await assertForbidden(await GET(getReq(bearer("wrong-token"))));
  });

  test("a signed-in non-admin is refused", async () => {
    state.session = asUser();
    await assertForbidden(await GET(getReq()));
  });

  test("an admin session cannot rescue an unset CRON_SECRET", async () => {
    state.session = asAdmin();
    delete process.env.CRON_SECRET;
    await assertForbidden(await GET(getReq(bearer())));
  });
});

describe("GET cannot be steered at a chosen file", () => {
  test("it always takes the batch, never a named key", async () => {
    await GET(getReq(bearer()));
    // The keys scanned are the pipeline's own selection, not anything the
    // caller supplied.
    assert.deepEqual(state.scanned, BATCH_KEYS);
    assert.deepEqual(state.findScannableCalls, [5]);
  });

  test("the GET handler never reads a request body", () => {
    const get = handlerSource("GET");
    assert.ok(!/req\.json\(\)/.test(get), "GET must not parse a body");
    assert.ok(!/\bbody\b/.test(get), "GET must not reference a body");
    assert.ok(!/requestedKey/.test(get), "GET must not accept a key");
  });
});

describe("GET refuses before spending anything when unconfigured", () => {
  test("an unconfigured provider returns 503 and scans nothing", async () => {
    state.configured = false;
    const res = await GET(getReq(bearer()));
    assert.equal(res.status, 503);

    const body = await res.json();
    assert.equal(body.error, "scanner_unconfigured");
    assert.equal(body.scanned, 0);
    assert.deepEqual(state.scanned, []);
    // Nothing was even selected, so no retry budget was touched.
    assert.deepEqual(state.findScannableCalls, []);
  });

  test("authorization is checked before configuration", async () => {
    // An unauthorised caller must not learn whether the scanner is set up.
    state.configured = false;
    const res = await GET(getReq());
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "Forbidden");
  });
});

/* ------------------------------------------------------------------ */
/* POST — unchanged behaviour                                          */
/* ------------------------------------------------------------------ */

describe("POST still behaves exactly as it did", () => {
  test("an admin session is accepted, with no bearer", async () => {
    state.session = asAdmin();
    const res = await POST(postReq({}));
    assert.equal(res.status, 200);
    assert.deepEqual(state.scanned, BATCH_KEYS);
  });

  test("the cron bearer is accepted, with no session", async () => {
    const res = await POST(postReq({}, bearer()));
    assert.equal(res.status, 200);
    assert.deepEqual(state.scanned, BATCH_KEYS);
  });

  test("a non-admin session is refused", async () => {
    state.session = asUser();
    await assertForbidden(await POST(postReq({})));
  });

  test("no session and no bearer is refused", async () => {
    await assertForbidden(await POST(postReq({})));
  });

  test("an explicit key scans exactly that one file", async () => {
    state.session = asAdmin();
    const res = await POST(postReq({ key: "oneSpecificKey01" }));
    assert.equal(res.status, 200);
    assert.deepEqual(state.scanned, ["oneSpecificKey01"]);
    // The batch selector was never consulted.
    assert.deepEqual(state.findScannableCalls, []);
  });

  test("an absent body falls back to the batch", async () => {
    state.session = asAdmin();
    const res = await POST(postReq());
    assert.equal(res.status, 200);
    assert.deepEqual(state.scanned, BATCH_KEYS);
  });

  test("malformed JSON falls back to the batch rather than throwing", async () => {
    state.session = asAdmin();
    const req = new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    assert.deepEqual(state.scanned, BATCH_KEYS);
  });

  test("an unconfigured provider returns 503", async () => {
    state.session = asAdmin();
    state.configured = false;
    const res = await POST(postReq({}));
    assert.equal(res.status, 503);
    assert.deepEqual(state.scanned, []);
  });
});

describe("POST trims the requested key", () => {
  test("surrounding whitespace and newlines are stripped", async () => {
    state.session = asAdmin();
    await POST(postReq({ key: "  paddedKey12345\n" }));
    assert.deepEqual(state.scanned, ["paddedKey12345"]);
  });

  test("a whitespace-only key is treated as no key, not as an empty key", async () => {
    state.session = asAdmin();
    const res = await POST(postReq({ key: "   \n\t " }));
    assert.equal(res.status, 200);
    // It must run a normal batch, never scanFileAsset("").
    assert.deepEqual(state.scanned, BATCH_KEYS);
    assert.ok(!state.scanned.includes(""));
  });

  test("an empty-string key is treated as no key", async () => {
    state.session = asAdmin();
    await POST(postReq({ key: "" }));
    assert.deepEqual(state.scanned, BATCH_KEYS);
  });

  test("a non-string key is ignored", async () => {
    state.session = asAdmin();
    for (const key of [42, null, true, { k: "x" }, ["a"]]) {
      reset();
      state.session = asAdmin();
      const res = await POST(postReq({ key }));
      assert.equal(res.status, 200);
      assert.deepEqual(state.scanned, BATCH_KEYS);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Structure — the properties runtime tests cannot show                */
/* ------------------------------------------------------------------ */

const routeSrc = readFileSync(
  resolve(ROOT, "app/api/internal/scan/route.ts"),
  "utf8"
);

/**
 * Comments explain these guards at length and would satisfy naive text
 * assertions on their own. Strip them so every assertion below is about code.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The body of one exported handler, comments removed. */
function handlerSource(name: "GET" | "POST"): string {
  const code = stripComments(routeSrc);
  const start = code.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} handler not found`);
  const rest = code.slice(start + 1);
  const next = rest.indexOf("export async function ");
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the two methods are structurally unequal", () => {
  test("GET never calls getServerSession", () => {
    assert.ok(!/getServerSession/.test(handlerSource("GET")));
    assert.ok(!/isAdminEmail/.test(handlerSource("GET")));
  });

  test("the session check lives only in the POST authoriser", () => {
    const code = stripComments(routeSrc);
    const sessionUses = code.match(/getServerSession/g) ?? [];
    // Once in the import, once in authorizeAdminOrCron. Nowhere else.
    assert.equal(sessionUses.length, 2);
    assert.ok(/async function authorizeAdminOrCron/.test(code));
    assert.ok(/function authorizeCronOnly/.test(code));
  });

  test("the cron-only authoriser cannot reach a session", () => {
    const code = stripComments(routeSrc);
    const fn = code.slice(code.indexOf("function authorizeCronOnly"));
    const body = fn.slice(0, fn.indexOf("}") + 1);
    assert.ok(!/getServerSession|session/.test(body));
  });

  test("the worker still never echoes a cause", () => {
    const code = stripComments(routeSrc);
    assert.ok(code.includes("(error as Error)?.name"));
    assert.ok(!/console\.error\([^)]*error\)/.test(code));
  });

  test("no secret value is hard-coded in the route source", () => {
    const code = stripComments(routeSrc);
    // The secret is only ever read from the environment.
    assert.ok(code.includes("process.env.CRON_SECRET"));
    assert.ok(!/CRON_SECRET\s*=\s*["'][^"']+["']/.test(code));
  });

  test("the secret is confined to the one function that compares it", () => {
    // The property that matters is containment, not the absence of the word.
    // Comparing the header against `Bearer ${cronSecret}` IS the job; what
    // must never happen is the value reaching a log, a response body, or any
    // other code path. Proving every mention lives inside hasCronBearer
    // proves all of those at once, and keeps proving them as the file grows.
    const code = stripComments(routeSrc);
    const start = code.indexOf("function hasCronBearer");
    assert.notEqual(start, -1);
    const after = code.slice(start);
    const body = after.slice(0, after.indexOf("\n}") + 2);

    const total = (code.match(/cronSecret/g) ?? []).length;
    const inside = (body.match(/cronSecret/g) ?? []).length;
    assert.ok(total > 0, "the secret must actually be read somewhere");
    assert.equal(
      total,
      inside,
      "cronSecret is referenced outside hasCronBearer"
    );
  });

  test("the secret never reaches a log or a response body", () => {
    const code = stripComments(routeSrc);
    assert.ok(!/console\.\w+\([^)]*cronSecret/.test(code));
    assert.ok(!/NextResponse\.json\([^)]*cronSecret/.test(code));
    assert.ok(!/CRON_SECRET/.test(code.replace(/process\.env\.CRON_SECRET/g, "")));
  });
});

/* ------------------------------------------------------------------ */
/* The schedule                                                        */
/* ------------------------------------------------------------------ */

describe("vercel.json declares the schedule the handler expects", () => {
  const vercel = JSON.parse(
    readFileSync(resolve(ROOT, "vercel.json"), "utf8")
  ) as {
    crons?: { path: string; schedule: string }[];
    functions?: Record<string, { maxDuration?: number }>;
  };

  test("exactly one cron is declared", () => {
    assert.ok(Array.isArray(vercel.crons));
    assert.equal(vercel.crons!.length, 1);
  });

  test("it runs every five minutes", () => {
    assert.equal(vercel.crons![0].schedule, "*/5 * * * *");
  });

  test("its path is the scan route, and that route exports GET", () => {
    assert.equal(vercel.crons![0].path, "/api/internal/scan");
    // The path must correspond to a real file that answers GET, or the
    // schedule 405s every five minutes with nobody watching.
    assert.ok(/export async function GET\(/.test(routeSrc));
  });

  test("the scan route keeps its own duration budget", () => {
    // 300s, not the 30s the rest of app/api gets. A batch that cannot finish
    // would leave assets claimed until their lease expires.
    assert.equal(
      vercel.functions?.["app/api/internal/scan/route.ts"]?.maxDuration,
      300
    );
  });

  test("the cron period exceeds no lease and loses no work", () => {
    // Every 5 minutes against a 300s ceiling means at most one prior
    // invocation can still be running. That is safe — the atomic claim in
    // lib/scan/run.ts guarantees the newcomer finds nothing to take — but it
    // is the reason not to schedule any tighter.
    const [minutes] = vercel.crons![0].schedule.split(" ");
    assert.equal(minutes, "*/5");
  });
});

describe(".env.example documents the variable without disclosing it", () => {
  const example = readFileSync(resolve(ROOT, ".env.example"), "utf8");

  test("CRON_SECRET is documented", () => {
    assert.ok(example.includes("CRON_SECRET="));
  });

  test("the documented value is an obvious placeholder", () => {
    const line = example
      .split("\n")
      .find((l) => l.startsWith("CRON_SECRET="))!;
    assert.ok(/generate-with-openssl/.test(line));
    // Nothing that looks like a real high-entropy token.
    assert.ok(!/[A-Za-z0-9+/]{40,}/.test(line));
  });
});
