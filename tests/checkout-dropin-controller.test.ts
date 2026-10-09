/**
 * lib/checkout/dropin-controller: the embedded checkout's decisions, as behaviour.
 *
 * The browser is a fake host: every POST is held until the test answers it,
 * navigation and storage are recorded, Geidea's constructor captures the
 * three callbacks it is given, and timers are collected. So the races the
 * page must survive are driven in exactly the order a test chooses.
 *
 * The rule under test above all: once this page has asked for an embedded
 * session, nothing the browser sees makes it ask for a second payable one.
 * And every checkout request, from every tab of the browser, waits its turn
 * under one lock, so two tabs never ask at once; without that lock, no
 * checkout request is sent at all.
 *
 * MOCKED: the browser, its lock and the checkout route are stand-ins here.
 * The lock stand-in follows the contract of lib/checkout/tab-lock, whose
 * own behaviour is tested in checkout-tab-lock.test.ts. No real browser, no
 * real route and no database run in this file.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CHECKOUT_LOCK,
  DROPIN_REQUEST,
  HOSTED_REQUEST,
  PENDING_RETRY_MS,
  createDropInController,
  resumeIfReturning,
  type CheckoutReply,
  type DropInController,
  type DropInHost,
  type GeideaCallback,
  type PanelState,
} from "../lib/checkout/dropin-controller";
import { DROPIN_CONTAINER_PREFIX, serializeAttempt } from "../lib/checkout/embedded";
import type { LockOutcome } from "../lib/checkout/tab-lock";

/** The receipt address the page has already checked; it rides along with every request. */
const BUYER_EMAIL = "buyer@example.com";
const NOW = Date.parse("2026-09-25T12:00:00Z");
const REF_A = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const REF_B = "0b8f3c52-51c1-4a0e-9d7e-3f2a1b6c9d10";
const SESSION_A = "f1a0f785-7601-4d53-8f43-08dc33d8302c";
const SESSION_B = "a2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d";
const HOSTED_SESSION = "11111111-2222-4333-8444-555555555555";
const SCRIPT = "https://hpp.geidea.test/hpp/geideaCheckout.min.js";
const HOSTED_URL = `https://hpp.geidea.test/hpp/checkout/?${HOSTED_SESSION}`;
const STATUS_A = `/success?ref=${REF_A}`;
const STATUS_B = `/success?ref=${REF_B}`;

const dropinBody = (ref = REF_A, sessionId = SESSION_A, expiresAt = "2026-09-25T12:15:00Z", scriptUrl = SCRIPT) => ({
  sessionId,
  scriptUrl,
  expiresAt,
  successPath: `/success?ref=${ref}`,
});
const ok = (body: unknown): CheckoutReply => ({ ok: true, status: 200, body });
const conflict = (body: unknown): CheckoutReply => ({ ok: false, status: 409, body });

/** The browser tab: shared by every controller created in it, like the real one. */
class Browser {
  navigations: string[] = [];
  replacements: string[] = [];
  scriptLoads: string[] = [];
  stored: string | null = null;
  search = "";
  scriptFails = false;
  constructorMissing = false;
  startPaymentThrows = false;
  /** Whether Geidea places its iframe in the container it was given. */
  frameAppears = true;
  /** Container ids that currently hold a Geidea iframe: the DOM, as far as readiness is concerned. */
  framedContainers = new Set<string>();
  tokens = 0;
  /**
   * The browser's lock, as lib/checkout/tab-lock reports it: granted; missing
   * or refused, so the task never runs; or a lock call that rejects outright.
   */
  lockMode: "granted" | "missing" | "refused" | "rejects" = "granted";
  /** The lock's queue, shared by every tab: each task starts when the one before it has finished. */
  lockTail: Promise<void> = Promise.resolve();
  lockHolders = 0;
  mostLockHolders = 0;
  lockGrants = 0;
  lockNames = new Set<string>();
  /** Called the moment a page asks for the lock, before any answer. */
  onLockRequest: (() => void) | null = null;
  /** The checkout identity cookie, shared by every tab, as the latest reply that set it left it. */
  cookie: string | null = null;
}

interface PendingPost {
  url: string;
  body: { productId: string; buyerEmail: string };
  /** The identity cookie the request carried: the jar's value when it was sent. */
  cookie: string | null;
  resolve: (reply: CheckoutReply) => void;
  reject: (error: unknown) => void;
}

interface GeideaInstance {
  sessionId: string;
  containerId: string;
  onSuccess: GeideaCallback;
  onError: GeideaCallback;
  onCancel: GeideaCallback;
}

function setup(browser = new Browser(), productId = "prod_1", scriptUrl: string | null = SCRIPT) {
  const posts: PendingPost[] = [];
  const waits: string[] = [];
  const states: PanelState[] = [];
  const geidea: GeideaInstance[] = [];
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];

  class FakeGeidea {
    private readonly callbacks: [GeideaCallback, GeideaCallback, GeideaCallback];
    constructor(onSuccess: GeideaCallback, onError: GeideaCallback, onCancel: GeideaCallback) {
      this.callbacks = [onSuccess, onError, onCancel];
    }
    startPayment(sessionId: string, _options: null, containerId: string) {
      if (browser.startPaymentThrows) throw new Error("boom");
      const [onSuccess, onError, onCancel] = this.callbacks;
      geidea.push({ sessionId, containerId, onSuccess, onError, onCancel });
      if (browser.frameAppears) browser.framedContainers.add(containerId);
    }
  }

  const host: DropInHost = {
    post: (url, body) =>
      new Promise<CheckoutReply>((resolve, reject) => {
        posts.push({ url, body, cookie: browser.cookie, resolve, reject });
      }),
    navigate: (url) => browser.navigations.push(url),
    replace: (url) => browser.replacements.push(url),
    search: () => browser.search,
    readAttempt: () => browser.stored,
    writeAttempt: (value) => {
      browser.stored = value;
    },
    clearAttempt: () => {
      browser.stored = null;
    },
    loadScript: async (url) => {
      browser.scriptLoads.push(url);
      if (browser.scriptFails) throw new Error("load");
    },
    geideaCheckout: () => (browser.constructorMissing ? undefined : (FakeGeidea as never)),
    waitForFrame: async (containerId) => {
      waits.push(containerId);
      return browser.framedContainers.has(containerId);
    },
    nonce: () => `token-${++browser.tokens}`,
    now: () => NOW,
    setTimer: (callback, ms) => {
      timers.push({ callback, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimer: (handle) => {
      timers[handle as number].cleared = true;
    },
    withLock<T>(name: string, task: () => Promise<T>): Promise<LockOutcome<T>> {
      browser.lockNames.add(name);
      browser.onLockRequest?.();
      if (browser.lockMode === "missing" || browser.lockMode === "refused") {
        return Promise.resolve<LockOutcome<T>>({ held: false });
      }
      if (browser.lockMode === "rejects") return Promise.reject(new Error("the lock call failed"));
      const turn = browser.lockTail.then(() => {
        browser.lockHolders++;
        browser.lockGrants++;
        browser.mostLockHolders = Math.max(browser.mostLockHolders, browser.lockHolders);
        return task()
          .then((value): LockOutcome<T> => ({ held: true, value }))
          .finally(() => {
            browser.lockHolders--;
          });
      });
      browser.lockTail = turn.then(
        () => undefined,
        () => undefined
      );
      return turn;
    },
  };

  const controller: DropInController = createDropInController(productId, BUYER_EMAIL, scriptUrl, host, (state) => states.push(state));
  return { browser, controller, posts, waits, states, geidea, timers, last: () => states[states.length - 1] };
}

/** Let every pending promise continuation run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Start a controller and answer its drop-in request, leaving the form on screen. */
async function ready(t: ReturnType<typeof setup>, body = dropinBody()) {
  const started = t.controller.start();
  await settle();
  assert.equal(t.posts.length, 1);
  t.posts[0].resolve(ok(body));
  await started;
  assert.equal(t.last().kind, "ready", "the form is on screen");
  return t;
}

/** Start a controller whose Geidea library will not load, leaving the hosted page offered. */
async function fallback(t: ReturnType<typeof setup>) {
  t.browser.scriptFails = true;
  await t.controller.start();
  assert.deepEqual(t.last(), { kind: "fallback" });
  assert.equal(t.posts.length, 0, "nothing was requested");
  return t;
}

const attemptRef = (stored: string | null) => (stored === null ? null : JSON.parse(stored).successPath);

/**
 * Ask for the hosted page where it must be refused. A refusal sends nothing,
 * so nothing is awaited that a regression could leave pending forever: the
 * test fails on the count instead of hanging.
 */
async function refuseHosted(run: ReturnType<typeof setup>, label = "no hosted request") {
  const before = run.posts.length;
  void run.controller.continueOnHostedPage();
  await settle();
  assert.equal(run.posts.length, before, label);
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

/* ------------------------------------------------------------------ */
/* Starting                                                            */
/* ------------------------------------------------------------------ */

describe("starting the embedded form", () => {
  test("loads Geidea's library first, then asks for a drop-in session naming the product and nothing else", async () => {
    await ready(t);
    assert.deepEqual(t.browser.scriptLoads, [SCRIPT], "the library, before any request");
    assert.equal(t.posts[0].url, DROPIN_REQUEST);
    assert.deepEqual(t.posts[0].body, { productId: "prod_1", buyerEmail: BUYER_EMAIL });
    assert.deepEqual(t.geidea.map((g) => [g.sessionId, g.containerId]), [[SESSION_A, t.controller.containerId]]);
    assert.deepEqual(t.waits, [t.controller.containerId], "readiness is read from the same container");
    assert.equal(attemptRef(t.browser.stored), STATUS_A, "the attempt is recorded for recovery");
    assert.deepEqual(t.last(), { kind: "ready", expired: false, statusPath: STATUS_A });
  });

  test("while nothing could have been paid, a library that will not load offers the hosted page and requests nothing", async () => {
    const cases: [string, (b: Browser) => void, string | null][] = [
      ["script fails", (b) => (b.scriptFails = true), SCRIPT],
      ["constructor missing", (b) => (b.constructorMissing = true), SCRIPT],
      ["no library configured", () => {}, null],
    ];
    for (const [label, arrange, scriptUrl] of cases) {
      const run = setup(new Browser(), "prod_1", scriptUrl);
      arrange(run.browser);
      await run.controller.start();
      assert.deepEqual(run.last(), { kind: "fallback" }, label);
      assert.equal(run.posts.length, 0, `${label}: no session was requested`);
      assert.equal(run.browser.navigations.length, 0, `${label}: nothing navigates on its own`);
    }
  });

  test("once a session reached the page, a form that will not show offers that session again and its status page, never the hosted page", async () => {
    const cases: [string, (b: Browser) => void][] = [
      ["startPayment throws", (b) => (b.startPaymentThrows = true)],
      ["no iframe appears", (b) => (b.frameAppears = false)],
    ];
    for (const [label, arrange] of cases) {
      const run = setup();
      arrange(run.browser);
      const started = run.controller.start();
      await settle();
      run.posts[0].resolve(ok(dropinBody()));
      await started;
      assert.deepEqual(run.last(), { kind: "stuck", statusPath: STATUS_A }, label);
      await refuseHosted(run, `${label}: no hosted request, ever`);
      assert.equal(run.posts.length, 1);
      assert.equal(run.browser.navigations.length, 0, label);
    }
  });

  test("an unusable reply is explained, never answered with the hosted page: a session may exist", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(ok({ url: HOSTED_URL }));
    await started;
    assert.deepEqual(t.last(), { kind: "unavailable", problem: "service" });
    await refuseHosted(t);
    assert.equal(t.posts.length, 1);
  });

  test("a reply naming another library than the one the page loaded is not mounted", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(ok(dropinBody(REF_A, SESSION_A, "2026-09-25T12:15:00Z", "https://other.geidea.test/hpp/geideaCheckout.min.js")));
    await started;
    assert.deepEqual(t.last(), { kind: "stuck", statusPath: STATUS_A });
    assert.equal(t.geidea.length, 0);
  });

  test("a refusal from the route explains itself and offers no hosted page", async () => {
    for (const [status, problem] of [[429, "rate_limited"], [400, "not_available"], [503, "payments_off"], [502, "service"]] as const) {
      const run = setup();
      const started = run.controller.start();
      await settle();
      run.posts[0].resolve({ ok: false, status, body: { error: "x" } });
      await started;
      assert.deepEqual(run.last(), { kind: "unavailable", problem });
    }
    const offline = setup();
    const started = offline.controller.start();
    await settle();
    offline.posts[0].reject(new TypeError("Failed to fetch"));
    await started;
    assert.deepEqual(offline.last(), { kind: "unavailable", problem: "service" });
  });

  test("an expired session is reported and the form is left alone", async () => {
    await ready(t);
    const expiry = t.timers[0];
    assert.equal(expiry.ms, 15 * 60 * 1000);
    expiry.callback();
    assert.deepEqual(t.last(), { kind: "ready", expired: true, statusPath: STATUS_A });
  });
});

/* ------------------------------------------------------------------ */
/* The server's current attempt, not the page, decides                  */
/* ------------------------------------------------------------------ */

describe("this browser's existing attempt decides, not the page", () => {
  test("already paid: the buyer goes to that attempt's status page and no form mounts", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(conflict({ error: "already_paid", statusPath: STATUS_A }));
    await started;
    assert.deepEqual(t.browser.replacements, [STATUS_A]);
    assert.equal(t.geidea.length, 0);
    await refuseHosted(t, "and nothing more is asked");
  });

  test("an attempt that might still be paid: its status page, not a new form", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(conflict({ error: "attempt_open", statusPath: STATUS_A }));
    await started;
    assert.deepEqual(t.browser.replacements, [STATUS_A]);
    assert.equal(t.geidea.length, 0);
  });

  test("a status path that is not SaiFlow's own is never followed", async () => {
    for (const statusPath of ["https://evil.example/success?ref=x", "/api/download/x", "/success?ref=not-a-uuid", undefined]) {
      const run = setup();
      const started = run.controller.start();
      await settle();
      run.posts[0].resolve(conflict({ error: "attempt_open", statusPath }));
      await started;
      assert.deepEqual(run.browser.replacements, [], String(statusPath));
      assert.deepEqual(run.last(), { kind: "unavailable", problem: "service" });
    }
  });

  test("still being created by another request: one short wait, then the same request, which resumes", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(conflict({ error: "attempt_pending", statusPath: STATUS_A }));
    await settle();
    assert.equal(t.timers.length, 1);
    assert.equal(t.timers[0].ms, PENDING_RETRY_MS);
    assert.equal(t.posts.length, 1, "nothing until the wait is over");
    t.timers[0].callback();
    await settle();
    assert.equal(t.posts.length, 2);
    assert.equal(t.posts[1].url, DROPIN_REQUEST, "the same request, never the hosted one");
    t.posts[1].resolve(ok(dropinBody()));
    await started;
    assert.deepEqual(t.last(), { kind: "ready", expired: false, statusPath: STATUS_A });
  });

  test("still being created after the wait: its status page, without a third request", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(conflict({ error: "attempt_pending", statusPath: STATUS_A }));
    await settle();
    t.timers[0].callback();
    await settle();
    t.posts[1].resolve(conflict({ error: "attempt_pending", statusPath: STATUS_A }));
    await started;
    assert.deepEqual(t.browser.replacements, [STATUS_A]);
    assert.equal(t.posts.length, 2);
  });

  test("still being created, with no status path to go to: explained, not guessed", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(conflict({ error: "attempt_pending" }));
    await settle();
    t.timers[0].callback();
    await settle();
    t.posts[1].resolve(conflict({ error: "attempt_pending" }));
    await started;
    assert.deepEqual(t.last(), { kind: "unavailable", problem: "service" });
    assert.deepEqual(t.browser.replacements, []);
  });

  test("a page that goes during the wait asks nothing more", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(conflict({ error: "attempt_pending", statusPath: STATUS_A }));
    await settle();
    t.controller.dispose();
    t.timers[0].callback();
    await started;
    assert.equal(t.posts.length, 1);
  });

  test("a reload is a new page that asks again and mounts what the server resumes: the same session", async () => {
    const browser = new Browser();
    const first = await ready(setup(browser));
    first.controller.dispose();
    // The reload: a fresh page in the same tab, whose request the server
    // answers with this browser's current attempt.
    const second = await ready(setup(browser), dropinBody());
    assert.deepEqual(
      [...first.geidea, ...second.geidea].map((g) => g.sessionId),
      [SESSION_A, SESSION_A],
      "one Geidea session, shown twice"
    );
    assert.deepEqual([...first.posts, ...second.posts].map((p) => p.url), [DROPIN_REQUEST, DROPIN_REQUEST]);
  });
});

/* ------------------------------------------------------------------ */
/* One identity, one asker at a time                                   */
/* ------------------------------------------------------------------ */

const IDENTITY_REQUIRED: CheckoutReply = { ok: false, status: 428, body: { error: "identity_required" } };

describe("the browser's checkout identity, and one asker at a time", () => {
  test("issued an identity and nothing else, the page asks again at once, and the second answer is the session", async () => {
    const started = t.controller.start();
    await settle();
    assert.equal(t.posts.length, 1);
    t.posts[0].resolve(IDENTITY_REQUIRED);
    await settle();
    assert.deepEqual(t.posts.map((p) => p.url), [DROPIN_REQUEST, DROPIN_REQUEST], "the same request again, never the hosted one");
    assert.equal(t.timers.length, 0, "without waiting");
    t.posts[1].resolve(ok(dropinBody()));
    await started;
    assert.deepEqual(t.last(), { kind: "ready", expired: false, statusPath: STATUS_A });
  });

  test("a browser that does not keep the cookie is asked once more, then told to allow cookies", async () => {
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(IDENTITY_REQUIRED);
    await settle();
    t.posts[1].resolve(IDENTITY_REQUIRED);
    await started;
    assert.equal(t.posts.length, 2, "never a third request");
    assert.deepEqual(t.last(), { kind: "unavailable", problem: "cookies" });
    await refuseHosted(t, "and no hosted request either: a session request was made");
  });

  test("the hosted request is issued its identity the same way", async () => {
    await fallback(t);
    const leaving = t.controller.continueOnHostedPage();
    await settle();
    t.posts[0].resolve(IDENTITY_REQUIRED);
    await settle();
    assert.deepEqual(t.posts.map((p) => p.url), [HOSTED_REQUEST, HOSTED_REQUEST]);
    t.posts[1].resolve(ok({ url: HOSTED_URL }));
    await leaving;
    assert.deepEqual(t.browser.navigations, [HOSTED_URL]);
  });

  test("two tabs opened at once ask one at a time: the second asks only once the first has its session", async () => {
    const browser = new Browser();
    const a = setup(browser);
    const b = setup(browser);
    const startedA = a.controller.start();
    const startedB = b.controller.start();
    await settle();
    assert.equal(a.posts.length + b.posts.length, 1, "one tab asks; the other waits its turn");
    const [first, second] = a.posts.length === 1 ? [a, b] : [b, a];

    first.posts[0].resolve(IDENTITY_REQUIRED);
    await settle();
    assert.equal(first.posts.length, 2);
    assert.equal(second.posts.length, 0, "still waiting while the first is issued its identity and asks again");

    first.posts[1].resolve(ok(dropinBody()));
    await settle();
    assert.equal(second.posts.length, 1, "now the second asks, carrying the identity the first was issued");
    // The server answers it from the first tab's attempt: the same session.
    second.posts[0].resolve(ok(dropinBody()));
    await Promise.all([startedA, startedB]);
    assert.deepEqual([...first.geidea, ...second.geidea].map((g) => g.sessionId), [SESSION_A, SESSION_A]);
    assert.equal(browser.mostLockHolders, 1, "never two requests at once");
    assert.deepEqual([...browser.lockNames], [CHECKOUT_LOCK]);
  });

  test("a hosted request waits its turn too, and is answered from the first tab's attempt", async () => {
    const browser = new Browser();
    const a = setup(browser);
    const startedA = a.controller.start();
    await settle();
    assert.equal(a.posts.length, 1);
    const b = await fallback(setup(browser));
    const leaving = b.controller.continueOnHostedPage();
    await settle();
    assert.equal(b.posts.length, 0, "waiting for the first tab's request");
    a.posts[0].resolve(ok(dropinBody()));
    await startedA;
    await settle();
    assert.equal(b.posts.length, 1);
    b.posts[0].resolve(conflict({ error: "attempt_open", statusPath: STATUS_A }));
    await leaving;
    assert.deepEqual(browser.replacements, [STATUS_A]);
    assert.deepEqual(browser.navigations, []);
  });

  test("a page that goes while waiting its turn asks nothing, and the lock is released", async () => {
    const browser = new Browser();
    const a = setup(browser);
    const b = setup(browser);
    const startedA = a.controller.start();
    const startedB = b.controller.start();
    await settle();
    const [first, second] = a.posts.length === 1 ? [a, b] : [b, a];
    second.controller.dispose();
    first.posts[0].resolve(ok(dropinBody()));
    await Promise.all([startedA, startedB]);
    await settle();
    assert.equal(second.posts.length, 0);
    assert.equal(browser.lockHolders, 0);
  });

  test("a supported browser checks out as before: the identity and the session under one hold of the lock", async () => {
    const started = t.controller.start();
    await settle();
    assert.equal(t.posts[0].cookie, null);
    t.browser.cookie = "identity-1"; // the identity reply's cookie lands with it
    t.posts[0].resolve(IDENTITY_REQUIRED);
    await settle();
    assert.equal(t.posts[1].cookie, "identity-1");
    assert.equal(t.browser.lockHolders, 1, "still held between the identity and the retry");
    t.posts[1].resolve(ok(dropinBody()));
    await started;
    assert.deepEqual(t.last(), { kind: "ready", expired: false, statusPath: STATUS_A });
    assert.equal(t.browser.lockGrants, 1, "both requests ran inside one grant");
    assert.equal(t.browser.lockHolders, 0, "and the lock was released after the session reply");
  });

  test("two supported tabs with staggered replies: the second sends nothing, not even for an identity, while the first holds the lock; one payable session", async () => {
    const browser = new Browser();
    // What the checkout route would answer. A reply that issues an identity
    // sets the cookie only when it lands, which is what lets a slow reply
    // overwrite another tab's identity when tabs are not serialized.
    const server = { identities: [] as string[], sessions: new Map<string, string>() };
    const deliver = (post: PendingPost) => {
      if (post.cookie === null) {
        const identity = `identity-${server.identities.length + 1}`;
        server.identities.push(identity);
        browser.cookie = identity;
        post.resolve(IDENTITY_REQUIRED);
        return;
      }
      const sessionId = server.sessions.get(post.cookie) ?? (server.sessions.size === 0 ? SESSION_A : SESSION_B);
      server.sessions.set(post.cookie, sessionId);
      post.resolve(ok(dropinBody(REF_A, sessionId)));
    };

    const a = setup(browser);
    const b = setup(browser);
    const startedA = a.controller.start();
    const startedB = b.controller.start();
    await settle();
    const [first, second] = a.posts.length === 1 ? [a, b] : [b, a];
    assert.equal(first.posts.length, 1);
    assert.equal(first.posts[0].cookie, null, "the first tab asks with no identity yet");
    assert.equal(second.posts.length, 0, "the second has sent nothing, not even a request for an identity");

    // The first tab's identity reply is slow to land; the second still waits.
    await settle();
    assert.equal(second.posts.length, 0);
    deliver(first.posts[0]);
    await settle();
    assert.equal(first.posts.length, 2, "the first asks again, still holding the lock");
    assert.equal(first.posts[1].cookie, "identity-1");
    assert.equal(second.posts.length, 0, "and the second still waits");

    deliver(first.posts[1]);
    await settle();
    assert.equal(second.posts.length, 1, "only now does the second ask");
    assert.equal(second.posts[0].cookie, "identity-1", "carrying the first tab's identity");
    deliver(second.posts[0]);
    await Promise.all([startedA, startedB]);

    assert.deepEqual(server.identities, ["identity-1"], "one identity was ever issued");
    assert.equal(server.sessions.size, 1, "one payable session");
    assert.deepEqual([...first.geidea, ...second.geidea].map((g) => g.sessionId), [SESSION_A, SESSION_A]);
    assert.ok(second.posts.every((post) => post.cookie === "identity-1"));
    assert.equal(browser.mostLockHolders, 1);
  });
});

/* ------------------------------------------------------------------ */
/* No lock, no request                                                  */
/* ------------------------------------------------------------------ */

describe("a browser that cannot give checkout its cross-tab lock sends no checkout request at all", () => {
  test("no Web Locks: zero requests, and an explanation instead of a form", async () => {
    t.browser.lockMode = "missing";
    await t.controller.start();
    assert.equal(t.posts.length, 0);
    assert.deepEqual(t.last(), { kind: "unavailable", problem: "lock_unavailable" });
    assert.equal(t.geidea.length, 0, "no form was started");
    assert.deepEqual(t.browser.navigations, []);
    assert.deepEqual(t.browser.replacements, []);
    await refuseHosted(t, "and the hosted page is not offered as a way round it");
  });

  test("a lock the browser refuses: zero requests, and the same explanation", async () => {
    t.browser.lockMode = "refused";
    await t.controller.start();
    assert.equal(t.posts.length, 0);
    assert.deepEqual(t.last(), { kind: "unavailable", problem: "lock_unavailable" });
  });

  test("a lock call that rejects outright: zero requests, an explanation, and nothing left unhandled", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      t.browser.lockMode = "rejects";
      await t.controller.start();
      await settle();
      assert.equal(t.posts.length, 0, "no request, and no unlocked retry");
      assert.deepEqual(t.last(), { kind: "unavailable", problem: "service" });
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("the hosted fallback cannot go round the lock either", async () => {
    for (const mode of ["missing", "refused", "rejects"] as const) {
      const run = await fallback(setup());
      run.browser.lockMode = mode;
      await run.controller.continueOnHostedPage();
      assert.equal(run.posts.length, 0, mode);
      assert.deepEqual(run.browser.navigations, [], mode);
      assert.deepEqual(
        run.last(),
        { kind: "unavailable", problem: mode === "rejects" ? "service" : "lock_unavailable" },
        mode
      );
    }
  });

  test("a page that goes while the lock is being asked for draws nothing more", async () => {
    t.browser.lockMode = "missing";
    t.browser.onLockRequest = () => t.controller.dispose();
    await t.controller.start();
    assert.deepEqual([...t.browser.lockNames], [CHECKOUT_LOCK], "the lock was asked for");
    assert.equal(t.posts.length, 0);
    assert.deepEqual(t.states, [], "no explanation drawn on a page that has gone");
  });
});

/* ------------------------------------------------------------------ */
/* The hosted page, only while nothing is payable                      */
/* ------------------------------------------------------------------ */

describe("the hosted page is offered only before any session request", () => {
  test("library unavailable and nothing requested: one hosted request, then Geidea's hosted page", async () => {
    await fallback(t);
    const leaving = t.controller.continueOnHostedPage();
    assert.deepEqual(t.last(), { kind: "redirecting" });
    await settle();
    assert.equal(t.posts[0].url, HOSTED_REQUEST);
    assert.deepEqual(t.posts[0].body, { productId: "prod_1", buyerEmail: BUYER_EMAIL });
    t.posts[0].resolve(ok({ url: HOSTED_URL }));
    await leaving;
    assert.deepEqual(t.browser.navigations, [HOSTED_URL]);
  });

  test("a double tap sends one hosted request", async () => {
    await fallback(t);
    const first = t.controller.continueOnHostedPage();
    const second = t.controller.continueOnHostedPage();
    await settle();
    assert.equal(t.posts.length, 1);
    t.posts[0].resolve(ok({ url: HOSTED_URL }));
    await Promise.all([first, second]);
    assert.deepEqual(t.browser.navigations, [HOSTED_URL]);
  });

  test("an embedded payment in flight can never be joined by a hosted one: refused at every point after the request", async () => {
    // While the drop-in request is out.
    const inFlight = setup();
    const started = inFlight.controller.start();
    await settle();
    await refuseHosted(inFlight, "refused while the drop-in request is out");
    inFlight.posts[0].resolve(ok(dropinBody()));
    await started;

    // With the form on screen, the buyer perhaps mid-3-D Secure.
    const onScreen = await ready(setup());
    await refuseHosted(onScreen, "refused with the form on screen");
    assert.equal(onScreen.last().kind, "ready", "nothing changed");

    // After every outcome Geidea can report.
    for (const outcome of ["onSuccess", "onError", "onCancel"] as const) {
      const run = await ready(setup());
      run.geidea[0][outcome]({});
      await refuseHosted(run, `refused after ${outcome}`);
    }
  });

  test("the hosted request can be answered with this browser's existing attempt: its status page", async () => {
    await fallback(t);
    const leaving = t.controller.continueOnHostedPage();
    await settle();
    t.posts[0].resolve(conflict({ error: "attempt_open", statusPath: STATUS_A }));
    await leaving;
    assert.deepEqual(t.browser.replacements, [STATUS_A]);
    assert.deepEqual(t.browser.navigations, []);
  });

  test("only Geidea's hosted page, as the route returned it, is ever followed", async () => {
    for (const body of [{ url: "https://evil.example/login" }, { url: `http://hpp.geidea.test/hpp/checkout/?${HOSTED_SESSION}` }, {}, null]) {
      const run = await fallback(setup());
      const leaving = run.controller.continueOnHostedPage();
      await settle();
      run.posts[0].resolve(ok(body));
      await leaving;
      assert.deepEqual(run.browser.navigations, [], JSON.stringify(body));
      assert.deepEqual(run.last(), { kind: "unavailable", problem: "service" });
    }
  });

  test("a hosted request that is refused or cannot be sent is explained", async () => {
    const limited = await fallback(setup());
    const a = limited.controller.continueOnHostedPage();
    await settle();
    limited.posts[0].resolve({ ok: false, status: 429, body: { error: "Too many requests" } });
    await a;
    assert.deepEqual(limited.last(), { kind: "unavailable", problem: "rate_limited" });

    const offline = await fallback(setup());
    const b = offline.controller.continueOnHostedPage();
    await settle();
    offline.posts[0].reject(new TypeError("Failed to fetch"));
    await b;
    assert.deepEqual(offline.last(), { kind: "unavailable", problem: "service" });
  });
});

describe("the attempt stays recoverable", () => {
  test("a return to the page with a query string goes to that attempt's status page", async () => {
    const browser = new Browser();
    browser.search = "?returned=1";
    browser.stored = serializeAttempt({ productId: "prod_1", successPath: STATUS_A, startedAt: NOW - 60_000 });
    const run = setup(browser);
    await run.controller.start();
    assert.deepEqual(browser.replacements, [STATUS_A]);
    assert.equal(run.posts.length, 0, "no new session");
    assert.equal(browser.scriptLoads.length, 0, "not even the library");
    assert.equal(browser.stored, null, "cleared first, so the back button cannot loop");
  });

  test("the page applies the same rule before it asks for the receipt address", () => {
    const replaced: string[] = [];
    let stored: string | null = serializeAttempt({ productId: "prod_1", successPath: STATUS_A, startedAt: NOW - 60_000 });
    const host = {
      search: () => "?returned=1",
      readAttempt: () => stored,
      clearAttempt: () => {
        stored = null;
      },
      replace: (url: string) => {
        replaced.push(url);
      },
      now: () => NOW,
    };
    assert.equal(resumeIfReturning("prod_1", host), true);
    assert.deepEqual(replaced, [STATUS_A], "a buyer who has just paid is never shown a form");
    assert.equal(stored, null, "cleared first, so the back button cannot loop");

    const record = serializeAttempt({ productId: "prod_1", successPath: STATUS_A, startedAt: NOW - 60_000 });
    const plainVisit = { ...host, search: () => "", readAttempt: () => record };
    assert.equal(resumeIfReturning("prod_1", plainVisit), false, "a plain visit is asked for its address");
    const otherProduct = { ...host, readAttempt: () => record };
    assert.equal(resumeIfReturning("prod_2", otherProduct), false, "another product's attempt never redirects");
  });
});

/* ------------------------------------------------------------------ */
/* L1: nothing from a disposed page reaches the page the buyer is on   */
/* ------------------------------------------------------------------ */

describe("a checkout page that has gone does nothing", () => {
  test("unmount, then a stale success: no navigation, no state, storage untouched", async () => {
    await ready(t);
    const statesBefore = t.states.length;
    const storedBefore = t.browser.stored;
    t.controller.dispose();
    t.geidea[0].onSuccess({});
    t.geidea[0].onError({});
    t.geidea[0].onCancel({});
    assert.deepEqual(t.browser.navigations, []);
    assert.equal(t.states.length, statesBefore);
    assert.equal(t.browser.stored, storedBefore, "a stale success does not clear anything");
  });

  test("Buy, Back, Buy, then the old page's callback: the current checkout is unaffected", async () => {
    const browser = new Browser();
    const first = await ready(setup(browser));
    first.controller.dispose();

    const second = await ready(setup(browser), dropinBody(REF_B, SESSION_B));
    assert.equal(attemptRef(browser.stored), STATUS_B);
    const secondStates = second.states.length;

    first.geidea[0].onSuccess({});
    first.geidea[0].onError({});
    first.geidea[0].onCancel({});
    assert.deepEqual(browser.navigations, [], "the old attempt navigates nowhere");
    assert.equal(second.states.length, secondStates, "the current page's state is untouched");
    assert.deepEqual(second.last(), { kind: "ready", expired: false, statusPath: STATUS_B });
    assert.equal(attemptRef(browser.stored), STATUS_B, "the current attempt's record is untouched");

    second.geidea[0].onSuccess({});
    assert.deepEqual(browser.navigations, [STATUS_B], "and the current page still completes normally");
  });

  test("a drop-in reply that arrives after unmount writes nothing and mounts nothing", async () => {
    const started = t.controller.start();
    await settle();
    t.controller.dispose();
    t.posts[0].resolve(ok(dropinBody()));
    await started;
    assert.equal(t.browser.stored, null, "no attempt recorded over the current page's");
    assert.equal(t.geidea.length, 0, "Geidea was never started");
    assert.deepEqual(t.states, []);
  });

  test("a hosted reply that arrives after unmount does not navigate", async () => {
    await fallback(t);
    const leaving = t.controller.continueOnHostedPage();
    await settle();
    t.controller.dispose();
    t.posts[0].resolve(ok({ url: HOSTED_URL }));
    await leaving;
    assert.deepEqual(t.browser.navigations, []);
  });

  test("unmount clears the expiry timer, and a late tick does nothing", async () => {
    await ready(t);
    const count = t.states.length;
    t.controller.dispose();
    assert.equal(t.timers[0].cleared, true);
    t.timers[0].callback();
    assert.equal(t.states.length, count);
  });

  test("a disposed page's controls do nothing", async () => {
    await ready(t);
    t.controller.dispose();
    await refuseHosted(t);
    void t.controller.start();
    await settle();
    assert.equal(t.posts.length, 1);
    assert.deepEqual(t.browser.navigations, []);
  });
});

/* ------------------------------------------------------------------ */
/* No new authority                                                    */
/* ------------------------------------------------------------------ */

describe("no second payment or download authority is introduced", () => {
  test("the controller only ever calls the checkout route, and only with the product id and the receipt address", async () => {
    await ready(t);
    const hosted = await fallback(setup());
    const leaving = hosted.controller.continueOnHostedPage();
    await settle();
    hosted.posts[0].resolve(ok({ url: HOSTED_URL }));
    await leaving;
    assert.deepEqual([...t.posts, ...hosted.posts].map((p) => p.url), [DROPIN_REQUEST, HOSTED_REQUEST]);
    for (const post of [...t.posts, ...hosted.posts]) {
      assert.deepEqual(post.body, { productId: "prod_1", buyerEmail: BUYER_EMAIL });
    }
  });

  test("it goes only to a server-given success path, a checked status path or Geidea's hosted page", () => {
    const src = readFileSync(new URL("../lib/checkout/dropin-controller.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const forbidden of ["/api/download", "/api/webhooks", "/api/payment-status", "prisma", "downloadUrl", "orderId", "responseCode"]) {
      assert.ok(!src.includes(forbidden), `the controller references ${forbidden}`);
    }
    assert.deepEqual(src.match(/host\.navigate\(([^)]+)\)/g), ["host.navigate(parsed.successPath)", "host.navigate(url)"]);
    assert.deepEqual(src.match(/host\.replace\(([^)]+)\)/g), ["host.replace(resumeTo)", "host.replace(conflict.statusPath)"]);
    assert.match(src, /if \(!isHostedCheckoutUrl\(url\)\)/);
    assert.match(src, /attemptConflictFrom\(reply\.status, reply\.body\)/, "status paths pass the shared check first");
  });

  test("the hosted request is guarded by whether an embedded one was ever sent", () => {
    const src = readFileSync(new URL("../lib/checkout/dropin-controller.ts", import.meta.url), "utf8");
    assert.match(src, /sessionRequested = true;\s*\n\s*const reply = await requestSession\(DROPIN_REQUEST\)/);
    assert.match(src, /async function continueOnHostedPage\(\): Promise<void> \{\s*\n\s*if \(disposed \|\| settled !== null \|\| hostedInFlight \|\| sessionRequested\) return;/);
  });

  test("every checkout request runs under the browser-wide lock, and only there", () => {
    const src = readFileSync(new URL("../lib/checkout/dropin-controller.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert.match(src, /outcome = await host\.withLock\(CHECKOUT_LOCK, \(\) => askForSession\(url\)\);/);
    assert.equal((src.match(/askForSession\(/g) ?? []).length, 2, "defined once, called once, under the lock");
    assert.equal((src.match(/host\.post\(/g) ?? []).length, 1, "the only request is inside it");
    assert.match(
      src,
      /if \(!outcome\.held\) \{\s*if \(!disposed && settled === null\) emit\(\{ kind: "unavailable", problem: "lock_unavailable" \}\);\s*return null;\s*\}/,
      "no lock: an explanation, and nothing sent"
    );
  });

  test("Geidea's callbacks never read their payload", () => {
    const src = readFileSync(new URL("../lib/checkout/dropin-controller.ts", import.meta.url), "utf8");
    for (const name of ["onSuccess", "onError", "onCancel"]) {
      assert.match(src, new RegExp(`const ${name}: GeideaCallback = \\(\\) => \\{`), `${name} takes no argument`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Success always wins, and wins once                                   */
/* ------------------------------------------------------------------ */

describe("a success for this attempt always reaches this attempt's status page", () => {
  test("cancel, then success: the success navigates", async () => {
    await ready(t);
    t.geidea[0].onCancel({});
    assert.deepEqual(t.last(), { kind: "cancelled", statusPath: STATUS_A }, "the cancel offers the status page too");
    t.geidea[0].onSuccess({});
    assert.deepEqual(t.browser.navigations, [STATUS_A]);
    assert.deepEqual(t.last(), { kind: "confirming" });
  });

  test("error, then success: the success navigates", async () => {
    await ready(t);
    t.geidea[0].onError({});
    assert.equal(t.last().kind, "declined");
    t.geidea[0].onSuccess({});
    assert.deepEqual(t.browser.navigations, [STATUS_A]);
  });

  test("a form that did not appear in time, then a success after all: the status page", async () => {
    t.browser.frameAppears = false;
    const started = t.controller.start();
    await settle();
    t.posts[0].resolve(ok(dropinBody()));
    await started;
    assert.equal(t.last().kind, "stuck");
    t.geidea[0].onSuccess({});
    assert.deepEqual(t.browser.navigations, [STATUS_A]);
  });

  test("disposed, then a late success: ignored", async () => {
    await ready(t);
    t.geidea[0].onCancel({});
    t.controller.dispose();
    t.geidea[0].onSuccess({});
    assert.deepEqual(t.browser.navigations, []);
  });

  test("a repeated success navigates once", async () => {
    await ready(t);
    t.geidea[0].onSuccess({});
    t.geidea[0].onSuccess({});
    t.geidea[0].onCancel({});
    t.geidea[0].onError({});
    t.geidea[0].onSuccess({});
    assert.deepEqual(t.browser.navigations, [STATUS_A]);
    assert.deepEqual(t.last(), { kind: "confirming" }, "nothing after the success changes what the buyer sees");
  });

  test("the success only ever goes to this attempt's own status path, and still unlocks nothing itself", async () => {
    await ready(t);
    t.geidea[0].onError({ orderId: "attacker-chosen", reference: "00000000-0000-4000-8000-000000000000", downloadUrl: "/api/download/x" });
    t.geidea[0].onSuccess({ orderId: "attacker-chosen", reference: "00000000-0000-4000-8000-000000000000", successPath: "/elsewhere" });
    assert.deepEqual(t.browser.navigations, [STATUS_A], "the payload is ignored; the path is the server's");
  });
});

/* ------------------------------------------------------------------ */
/* One container per mount                                              */
/* ------------------------------------------------------------------ */

describe("each mounted checkout has its own Geidea container", () => {
  test("two mounts receive different container ids, both under the shared prefix", () => {
    const browser = new Browser();
    const a = setup(browser);
    const b = setup(browser);
    assert.notEqual(a.controller.containerId, b.controller.containerId);
    for (const id of [a.controller.containerId, b.controller.containerId]) {
      assert.ok(id.startsWith(`${DROPIN_CONTAINER_PREFIX}-`), id);
      assert.match(id, /^[A-Za-z0-9-]+$/, "safe as an HTML id");
    }
  });

  test("ids stay distinct even if the random token repeats", () => {
    const browser = new Browser();
    const a = setup(browser);
    browser.tokens = 0;
    const b = setup(browser);
    assert.notEqual(a.controller.containerId, b.controller.containerId);
  });

  test("an iframe in an old mount's container cannot make the new mount ready", async () => {
    const browser = new Browser();
    const first = await ready(setup(browser));
    first.controller.dispose();

    browser.frameAppears = false;
    const second = setup(browser);
    const started = second.controller.start();
    await settle();
    // The old page's Geidea iframe turns up late, in the OLD container.
    browser.framedContainers.add(first.controller.containerId);
    second.posts[0].resolve(ok(dropinBody(REF_B, SESSION_B)));
    await started;
    assert.deepEqual(second.waits, [second.controller.containerId], "readiness asked of the new container only");
    assert.deepEqual(second.last(), { kind: "stuck", statusPath: STATUS_B }, "not ready on the strength of the old iframe");
  });

  test("Buy, Back, Buy: the new page starts Geidea in its own container only", async () => {
    const browser = new Browser();
    const first = await ready(setup(browser));
    first.controller.dispose();
    const second = await ready(setup(browser), dropinBody(REF_B, SESSION_B));
    assert.notEqual(second.controller.containerId, first.controller.containerId);
    assert.deepEqual(second.geidea.map((g) => [g.sessionId, g.containerId]), [[SESSION_B, second.controller.containerId]]);
    assert.deepEqual(second.waits, [second.controller.containerId]);
    assert.ok(!second.waits.includes(first.controller.containerId));
  });
});
