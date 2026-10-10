/**
 * Live refresh of the seller's file state: uploaded → scanning → passed/failed
 * without a manual reload.
 *
 * The scheduler (lib/scan-status-polling) is tested BEHAVIOURALLY with an
 * injected clock and timers. The React hook and the two seller pages cannot
 * be rendered here (Node's runner has no DOM and strips types, not JSX), so
 * their wiring is checked STRUCTURALLY against the source; that section says
 * so in its name.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createScanPoller,
  hasScanInProgress,
  isScanInProgress,
  pollIntervalAt,
  SCAN_POLL_CADENCE,
  SCAN_POLL_MAX_MS,
  type CadenceStep,
  type PollableFileState,
} from "../lib/scan-status-polling";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** The source between two unique markers, so a check can be scoped to one function. */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `marker not found: ${start}`);
  const b = src.indexOf(end, a);
  assert.ok(b > a, `end marker not found after start: ${end}`);
  return src.slice(a, b);
}

const MAX = SCAN_POLL_MAX_MS;
/** The first phase's interval. Tests that stay inside the first 30 s step by it. */
const FAST = 2_500;

/**
 * The requested schedule, written out independently of the implementation:
 * every 2.5 s for the first 30 s, every 5 s until 2 min, every 15 s after
 * that, and nothing at or after the window. This is the oracle the poller's
 * actual reload times are compared against.
 */
function referenceTimes(maxMs = MAX): number[] {
  const out: number[] = [];
  let t = 0;
  for (;;) {
    t += t < 30_000 ? 2_500 : t < 120_000 ? 5_000 : 15_000;
    if (t >= maxMs) break;
    out.push(t);
  }
  return out;
}

/** Run everything queued behind the current macrotask (all pending microtasks). */
const flush = () => new Promise<void>((r) => setImmediate(r));

/** Deterministic timers: a virtual clock plus a queue of pending timeouts. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    schedule(fn: () => void, ms: number) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    cancel(handle: unknown) {
      pending.delete(handle as number);
    },
    get pendingCount() {
      return pending.size;
    },
    /** Advance time, firing due timers in order and flushing between them. */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Infinity;
        for (const [id, t] of pending) {
          if (t.at <= target && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        }
        if (dueId === null) break;
        const due = pending.get(dueId)!;
        pending.delete(dueId);
        now = due.at;
        due.fn();
        await flush();
      }
      now = target;
    },
  };
}

function setup(overrides: { isPaused?: () => boolean; cadence?: readonly CadenceStep[] } = {}) {
  const clock = fakeClock();
  const calls: number[] = [];
  let impl: () => unknown = () => {
    calls.push(clock.now());
  };
  const poller = createScanPoller({
    refresh: () => impl(),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    ...overrides,
  });
  return {
    clock,
    calls,
    poller,
    setRefresh(fn: () => unknown) {
      impl = () => {
        calls.push(clock.now());
        return fn();
      };
    },
  };
}

const uploaded: PollableFileState = { state: "uploaded" };
const scanning: PollableFileState = { state: "scanning" };
const passed: PollableFileState = { state: "passed" };
const failed: PollableFileState = { state: "failed" };

/* ------------------------------------------------------------------ */
/* 1. What counts as in progress                                       */
/* ------------------------------------------------------------------ */

describe("what counts as in progress", () => {
  test("uploaded and scanning are in progress; passed and failed are final", () => {
    assert.equal(isScanInProgress(uploaded), true);
    assert.equal(isScanInProgress(scanning), true);
    assert.equal(isScanInProgress(passed), false);
    assert.equal(isScanInProgress(failed), false);
  });

  test("a product with no file (null or undefined) is not in progress", () => {
    assert.equal(isScanInProgress(null), false);
    assert.equal(isScanInProgress(undefined), false);
    assert.equal(hasScanInProgress([null, undefined]), false);
    assert.equal(hasScanInProgress([]), false);
  });

  test("one in-progress file among finished ones keeps the list in progress", () => {
    assert.equal(hasScanInProgress([passed, failed, null, scanning]), true);
    assert.equal(hasScanInProgress([passed, failed, null]), false);
  });

  test("a failed state stays final whatever its retry flag says", () => {
    assert.equal(hasScanInProgress([{ state: "failed", canRetry: true } as PollableFileState]), false);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The cadence                                                      */
/* ------------------------------------------------------------------ */

describe("the cadence", () => {
  test("is the one asked for: 2.5 s, then 5 s from 30 s, then 15 s from 2 min", () => {
    assert.deepEqual(SCAN_POLL_CADENCE, [
      { untilMs: 30_000, intervalMs: 2_500 },
      { untilMs: 120_000, intervalMs: 5_000 },
      { untilMs: Infinity, intervalMs: 15_000 },
    ]);
    assert.equal(MAX, 15 * 60_000, "the 15-minute scan lifecycle window");
  });

  test("steps down exactly at the thresholds", () => {
    assert.equal(pollIntervalAt(0), 2_500);
    assert.equal(pollIntervalAt(29_999), 2_500);
    assert.equal(pollIntervalAt(30_000), 5_000);
    assert.equal(pollIntervalAt(119_999), 5_000);
    assert.equal(pollIntervalAt(120_000), 15_000);
    assert.equal(pollIntervalAt(MAX), 15_000);
    assert.equal(pollIntervalAt(Number.MAX_SAFE_INTEGER), 15_000);
  });

  test("honours a custom table and never returns less than its last step", () => {
    const table: CadenceStep[] = [{ untilMs: 10, intervalMs: 1 }, { untilMs: 20, intervalMs: 2 }];
    assert.equal(pollIntervalAt(0, table), 1);
    assert.equal(pollIntervalAt(10, table), 2);
    assert.equal(pollIntervalAt(1_000, table), 2, "past the table: the last step applies");
  });

  test("worst case over the whole window is 81 reloads (12 + 18 + 51)", () => {
    const times = referenceTimes();
    assert.equal(times.filter((t) => t <= 30_000).length, 12, "first 30 s at 2.5 s");
    assert.equal(times.filter((t) => t > 30_000 && t <= 120_000).length, 18, "30 s to 2 min at 5 s");
    assert.equal(times.filter((t) => t > 120_000).length, 51, "2 min to 15 min at 15 s");
    assert.equal(times.length, 81);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The poller (behavioural, injected clock)                         */
/* ------------------------------------------------------------------ */

describe("the poller", () => {
  test("Uploaded starts polling: the first reload runs 2.5 s after the data arrived", async () => {
    const { clock, calls, poller } = setup();
    poller.update(hasScanInProgress([uploaded]));
    assert.equal(poller.active, true);
    assert.equal(calls.length, 0, "nothing runs synchronously");
    await clock.advance(FAST - 1);
    assert.equal(calls.length, 0, "nothing runs early");
    await clock.advance(1);
    assert.deepEqual(calls, [FAST]);
  });

  test("Scanning starts polling and the cadence changes at the correct thresholds", async () => {
    const { clock, calls, poller } = setup();
    poller.update(hasScanInProgress([scanning]));
    await clock.advance(3 * 60_000);
    assert.deepEqual(calls, referenceTimes(3 * 60_000 + 1));
    const gaps = calls.map((t, i) => (i === 0 ? t : t - calls[i - 1]));
    assert.ok(calls.slice(0, 12).every((t, i) => gaps[i] === 2_500 && t <= 30_000), "2.5 s apart until 30 s");
    assert.ok(calls.slice(12, 30).every((t, i) => gaps[12 + i] === 5_000 && t <= 120_000), "5 s apart until 2 min");
    assert.ok(calls.slice(30).every((t, i) => gaps[30 + i] === 15_000 && t > 120_000), "15 s apart after 2 min");
    assert.equal(calls[11], 30_000, "the last fast reload is at 30 s");
    assert.equal(calls[12], 35_000, "the first medium reload is 5 s later");
    assert.equal(calls[29], 120_000, "the last medium reload is at 2 min");
    assert.equal(calls[30], 135_000, "the first slow reload is 15 s later");
    assert.equal(clock.pendingCount, 1, "exactly one timer is ever pending");
  });

  test("Passed stops polling at once: the pending reload is dropped and none follows", async () => {
    const { clock, calls, poller } = setup();
    poller.update(hasScanInProgress([uploaded]));
    await clock.advance(FAST);
    assert.equal(calls.length, 1);
    poller.update(hasScanInProgress([passed]));
    assert.equal(poller.active, false);
    assert.equal(clock.pendingCount, 0, "no timer left behind");
    await clock.advance(MAX);
    assert.equal(calls.length, 1);
  });

  test("Passed stops at once in the slow phase too, not at the next 15 s tick", async () => {
    const { clock, calls, poller } = setup();
    poller.update(true);
    await clock.advance(3 * 60_000 + 1_000);
    const before = calls.length;
    poller.update(hasScanInProgress([passed]));
    assert.equal(poller.active, false);
    assert.equal(clock.pendingCount, 0);
    await clock.advance(60 * 60_000);
    assert.equal(calls.length, before);
  });

  test("Failed stops polling too", async () => {
    const { clock, calls, poller } = setup();
    poller.update(hasScanInProgress([scanning]));
    await clock.advance(FAST * 2);
    assert.equal(calls.length, 2);
    poller.update(hasScanInProgress([failed]));
    assert.equal(poller.active, false);
    assert.equal(clock.pendingCount, 0);
    await clock.advance(MAX);
    assert.equal(calls.length, 2);
  });

  test("a mixed list polls until the LAST in-progress file settles", async () => {
    const { clock, calls, poller } = setup();
    poller.update(hasScanInProgress([passed, uploaded, scanning]));
    await clock.advance(FAST);
    poller.update(hasScanInProgress([passed, passed, scanning]));
    assert.equal(poller.active, true, "still one scanning");
    await clock.advance(FAST);
    poller.update(hasScanInProgress([passed, passed, failed]));
    assert.equal(poller.active, false);
    await clock.advance(MAX);
    assert.equal(calls.length, 2);
  });

  test("unmount (stop) ends polling, even while a reload is in flight", async () => {
    const { clock, calls, poller, setRefresh } = setup();
    let release!: () => void;
    setRefresh(() => new Promise<void>((r) => (release = r)));
    poller.update(true);
    await clock.advance(FAST);
    assert.equal(calls.length, 1, "the reload started");
    poller.stop();
    assert.equal(poller.active, false);
    release();
    await flush();
    assert.equal(clock.pendingCount, 0, "the finished reload did not re-arm");
    await clock.advance(MAX);
    assert.equal(calls.length, 1);
  });

  test("unmount in the slow phase drops the pending 15 s reload", async () => {
    const { clock, calls, poller } = setup();
    poller.update(true);
    await clock.advance(5 * 60_000);
    const before = calls.length;
    assert.equal(clock.pendingCount, 1);
    poller.stop();
    assert.equal(clock.pendingCount, 0);
    await clock.advance(MAX);
    assert.equal(calls.length, before);
  });

  test("stop is idempotent and a stopped poller can be started again", async () => {
    const { clock, calls, poller } = setup();
    poller.stop();
    poller.stop();
    assert.equal(poller.active, false);
    poller.update(true);
    await clock.advance(FAST);
    assert.equal(calls.length, 1);
  });

  test("the 15-minute cap holds: 81 reloads at the reference times, then it switches itself off", async () => {
    const { clock, calls, poller } = setup();
    poller.update(true);
    await clock.advance(MAX + 60 * 60_000);
    assert.deepEqual(calls, referenceTimes());
    assert.equal(calls.length, 81);
    assert.ok(calls[calls.length - 1] < MAX, "no reload at or after the window");
    assert.equal(poller.active, false, "the poller switched itself off");
    assert.equal(clock.pendingCount, 0, "and left no timer behind");
    for (let i = 1; i < calls.length; i++) {
      assert.ok(calls[i] - calls[i - 1] >= FAST, "reloads are never closer than 2.5 s");
    }
  });

  test("repeated 'in progress' updates neither restart the loop nor reset its window or cadence", async () => {
    const { clock, calls, poller } = setup();
    poller.update(true);
    await clock.advance(2 * 60_000);
    assert.equal(calls.length, 30);
    for (let i = 0; i < 5; i++) poller.update(true);
    assert.equal(clock.pendingCount, 1, "no duplicate loop");
    await clock.advance(MAX);
    assert.deepEqual(calls, referenceTimes(), "the window and the cadence still count from the first start");
    assert.equal(poller.active, false);
  });

  test("a new check after a stop gets a fresh window and starts fast again", async () => {
    const { clock, calls, poller } = setup();
    poller.update(true);
    await clock.advance(2 * 60_000);
    assert.equal(calls.length, 30, "into the slow phase");
    poller.update(false);
    await clock.advance(10 * 60_000);
    assert.equal(calls.length, 30);
    const restartAt = clock.now();
    poller.update(true);
    await clock.advance(FAST);
    assert.equal(calls[30], restartAt + FAST, "the first reload after a restart is 2.5 s later, not 15 s");
    await clock.advance(MAX);
    assert.deepEqual(calls.slice(30), referenceTimes().map((t) => restartAt + t));
    assert.equal(poller.active, false);
  });

  test("reloads never overlap: a slow reload delays the next tick instead of stacking requests", async () => {
    const { clock, calls, poller, setRefresh } = setup();
    let release!: () => void;
    setRefresh(() => new Promise<void>((r) => (release = r)));
    poller.update(true);
    await clock.advance(FAST);
    assert.equal(calls.length, 1);
    await clock.advance(FAST * 3);
    assert.equal(calls.length, 1, "no second reload while the first is pending");
    assert.ok(clock.pendingCount <= 1, "at most one timer");
    release();
    await flush();
    setRefresh(() => undefined);
    await clock.advance(FAST);
    assert.equal(calls.length, 2, "the next reload follows one interval after the tick that found it free");
  });

  test("reloads never overlap in the slow phase either", async () => {
    const { clock, calls, poller, setRefresh } = setup();
    poller.update(true);
    await clock.advance(3 * 60_000);
    const before = calls.length;
    let release!: () => void;
    setRefresh(() => new Promise<void>((r) => (release = r)));
    await clock.advance(15_000);
    assert.equal(calls.length, before + 1, "one slow reload started");
    await clock.advance(60_000);
    assert.equal(calls.length, before + 1, "and nothing stacked behind it for a minute");
    assert.ok(clock.pendingCount <= 1);
    release();
    await flush();
    setRefresh(() => undefined);
    await clock.advance(15_000);
    assert.equal(calls.length, before + 2);
  });

  test("a failing reload does not end the loop", async () => {
    const { clock, calls, poller, setRefresh } = setup();
    let n = 0;
    setRefresh(() => {
      n++;
      if (n === 1) throw new Error("sync failure");
      if (n === 2) return Promise.reject(new Error("async failure"));
      return undefined;
    });
    poller.update(true);
    await clock.advance(FAST * 4);
    assert.equal(calls.length, 4);
    assert.equal(poller.active, true);
  });

  test("while paused (hidden tab) reloads are skipped but the window still runs out", async () => {
    let paused = true;
    const { clock, calls, poller } = setup({ isPaused: () => paused });
    poller.update(true);
    await clock.advance(FAST * 3);
    assert.equal(calls.length, 0, "nothing reloads while hidden");
    assert.equal(poller.active, true, "but the loop is still alive");
    paused = false;
    await clock.advance(FAST);
    assert.equal(calls.length, 1, "the first tick after the tab is visible reloads");
    paused = true;
    await clock.advance(MAX);
    assert.equal(calls.length, 1);
    assert.equal(poller.active, false, "hidden or not, the window ends the loop");
    assert.equal(clock.pendingCount, 0);
  });

  test("a tab hidden through the fast phase comes back on the cadence its age dictates", async () => {
    let paused = true;
    const { clock, calls, poller } = setup({ isPaused: () => paused });
    poller.update(true);
    await clock.advance(3 * 60_000);
    assert.equal(calls.length, 0);
    paused = false;
    await clock.advance(15_000);
    assert.equal(calls.length, 1, "visible again after 3 min: the next reload is on the 15 s cadence");
    await clock.advance(15_000);
    assert.equal(calls.length, 2);
  });

  test("the poller calls nothing but the reload it was given", async () => {
    const { clock, calls, poller } = setup();
    poller.update(true);
    await clock.advance(FAST * 3);
    assert.equal(calls.length, 3);
    const src = read("lib/scan-status-polling.ts");
    for (const bad of ["fetch(", "XMLHttpRequest", "rescan", "method:", "POST", "prisma", "cloudmersive", "/api/"]) {
      assert.ok(!src.includes(bad), `the controller must not contain ${bad}`);
    }
  });

  test("Retry appears after a retryable Failed response: the modelled page loop ends on it", async () => {
    // The page: each reload replaces the value it renders, and (as the hook's
    // effect does after every render) reports whether it is still in progress.
    const responses: Array<PollableFileState & { canRetry?: boolean }> = [
      { state: "uploaded" },
      { state: "scanning" },
      { state: "scanning" },
      { state: "failed", canRetry: true },
    ];
    let view: (PollableFileState & { canRetry?: boolean }) | null = null;
    const { clock, calls, poller, setRefresh } = setup();
    setRefresh(() => {
      view = responses.shift() ?? view;
    });
    // Initial load said "uploaded".
    view = { state: "uploaded" };
    poller.update(isScanInProgress(view));

    for (let i = 0; i < 10; i++) {
      await clock.advance(FAST);
      poller.update(isScanInProgress(view));
    }

    assert.deepEqual(view, { state: "failed", canRetry: true }, "the last polled value is the retryable failure");
    assert.equal(calls.length, 4, "polling stopped as soon as the final state arrived");
    assert.equal(poller.active, false);
    assert.equal(clock.pendingCount, 0);
  });

  test("the same loop reaches Passed", async () => {
    const responses: PollableFileState[] = [scanning, scanning, passed];
    let view: PollableFileState = uploaded;
    const { clock, calls, poller, setRefresh } = setup();
    setRefresh(() => {
      view = responses.shift() ?? view;
    });
    poller.update(isScanInProgress(view));
    for (let i = 0; i < 10; i++) {
      await clock.advance(FAST);
      poller.update(isScanInProgress(view));
    }
    assert.deepEqual(view, passed);
    assert.equal(calls.length, 3);
    assert.equal(poller.active, false);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Wiring (STRUCTURAL: hook and pages are read as source)           */
/* ------------------------------------------------------------------ */

describe("wiring (structural: the hook and the pages are read as source, not rendered)", () => {
  const controller = read("lib/scan-status-polling.ts");
  const hook = read("lib/use-scan-status-polling.ts");
  const dashboard = read("app/dashboard/shop/[slug]/page.tsx");
  const edit = read("app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx");
  const component = read("components/FileScanState.tsx");

  test("the hook creates one poller, stops it on unmount, and re-evaluates on every state change", () => {
    assert.ok(hook.startsWith('"use client"'), "client module");
    assert.match(hook, /createScanPoller\(\{[\s\S]*?\}\);\s*pollerRef\.current = poller;[\s\S]*?\}, \[\]\);/, "created once");
    assert.match(hook, /return \(\) => \{\s*poller\.stop\(\);/, "cleanup stops the poller");
    assert.match(hook, /pollerRef\.current\?\.update\(inProgress\);\s*\}, \[inProgress\]\);/, "update keyed on inProgress");
    assert.match(hook, /refreshRef\.current = refresh;/, "the latest reload is used without restarting");
    assert.match(hook, /document\.visibilityState === "hidden"/, "hidden tabs pause reloads");
    assert.ok(!/setInterval/.test(hook + controller), "no free-running interval anywhere");
    assert.ok(!hook.includes("cadence"), "the hook takes the default cadence; pages cannot speed it up");
  });

  test("neither the controller nor the hook performs a request or names a write endpoint", () => {
    for (const [name, src] of [["controller", controller], ["hook", hook]] as const) {
      for (const bad of ["fetch(", "XMLHttpRequest", "rescan", "method:", "POST", "prisma", "cloudmersive", "/api/"]) {
        assert.ok(!src.includes(bad), `${name} contains ${bad}`);
      }
    }
  });

  test("the controller ships to the browser without the server-only state module", () => {
    // Comments may NAME the server module (they explain why it is not used);
    // an import statement may not.
    assert.ok(!/^\s*import\s/m.test(controller), "no imports at all");
    assert.ok(!/from\s+["'][^"']*seller-file-state/.test(controller), "never imports the server-side derivation");
    assert.ok(!/from\s+["']@\/lib\/scan\//.test(controller), "never imports the scan worker");
    assert.ok(!/from\s+["'][^"']*(seller-file-state|@\/lib\/scan\/|prisma)/.test(hook), "nor does the hook");
  });

  test("the dashboard polls its own shop payload with a GET and merges only the file fields", () => {
    assert.match(dashboard, /const scanInProgress = hasScanInProgress\(\(shop\?\.products \?\? \[\]\)\.map\(\(p\) => p\.fileState\)\);/);
    assert.match(dashboard, /useScanStatusPolling\(scanInProgress, refreshShop\);/);
    const body = between(dashboard, "async function refreshShop()", "async function handleDeleteProduct");
    assert.match(body, /fetch\(`\/api\/shops\/\$\{slug\}`\)/, "the existing shop endpoint");
    assert.ok(!body.includes("method:"), "a plain GET");
    assert.ok(!body.includes("rescan"), "never the retry endpoint");
    for (const f of ["hasFile", "fileSafety", "fileState"]) {
      assert.ok(body.includes(`${f}: next.${f}`), `merges ${f}`);
    }
    assert.ok(!body.includes("setError("), "silent on failure: no error screen from a poll");
    assert.ok(!body.includes("setLoading("), "no loading flicker");
    assert.ok(!body.includes("location.reload"), "no page reload");
  });

  test("the review notice is driven by the same derivation that drives polling", () => {
    assert.match(dashboard, /\{scanInProgress && \(/);
    assert.ok(
      !dashboard.includes('p.fileState?.state === "scanning" || p.fileState?.state === "uploaded"'),
      "the old inline derivation is gone"
    );
  });

  test("the retry flow on the dashboard is unchanged", () => {
    assert.match(dashboard, /onRetried=\{fetchShop\}/);
    assert.match(dashboard, /value=\{product\.fileState\}/);
  });

  test("hooks are called before either page's early returns", () => {
    assert.ok(dashboard.indexOf("useScanStatusPolling(") < dashboard.indexOf('if (status === "loading" || loading)'));
    assert.ok(edit.indexOf("useScanStatusPolling(") < edit.indexOf('if (status === "loading" || loading)'));
  });

  test("the edit page polls only while the saved file's badge is on screen, and never touches the form", () => {
    assert.match(edit, /product !== null && fileUrl === product\.fileUrl && isScanInProgress\(fileState\)/);
    assert.match(edit, /useScanStatusPolling\(scanInProgress, refreshFileState\);/);
    assert.match(edit, /product && fileUrl === product\.fileUrl && \([\s\S]*?<FileScanState productId=\{product\.id\} value=\{fileState\}/, "the badge is shown under the same condition");
    const body = between(edit, "async function refreshFileState()", "async function handleSubmit");
    assert.match(body, /fetch\(`\/api\/shops\/\$\{slug\}`\)/, "the existing shop endpoint");
    assert.ok(!body.includes("method:"), "a plain GET");
    assert.ok(!body.includes("rescan"), "never the retry endpoint");
    assert.ok(!body.includes("/api/products/"), "not the product endpoint either: the derived state lives on the shop payload");
    for (const setter of [
      "setProduct(", "setName(", "setDescription(", "setPrice(", "setCategory(",
      "setFileUrl(", "setThumbnailUrl(", "setFileName(", "setError(", "setLoading(", "setSuccess(",
    ]) {
      assert.ok(!body.includes(setter), `${setter} must not be called by a poll`);
    }
    assert.ok(body.includes("setFileState("), "updates the state badge");
    assert.ok(body.includes("setFileSafety("), "and the coarse status beside it");
  });

  test("the retry button is rendered from the polled value alone", () => {
    assert.match(component, /value\.state === "failed" && value\.canRetry && \(/);
    assert.match(component, /onClick=\{retry\}/);
    assert.ok(!component.includes("useEffect"), "the component itself does not poll");
  });

  test("the client window equals the server's scanning window", () => {
    assert.match(read("lib/seller-file-state.ts"), /export const SCAN_WINDOW_MS = 15 \* 60_000;/);
    assert.match(controller, /export const SCAN_POLL_MAX_MS = 15 \* 60_000;/);
  });

  test("polling reaches nothing that scans, decides or retries", () => {
    // Imports only: the controller's comments name the server modules to
    // explain why they are NOT used here. The rest of the tree is shown
    // untouched through git in the report.
    for (const [name, src] of [["controller", controller], ["hook", hook]] as const) {
      const imports = src.match(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm) ?? [];
      for (const line of imports) {
        assert.ok(!/scan\/|rescan|payments|prisma|cloudmersive/.test(line), `${name} imports ${line.trim()}`);
      }
    }
    assert.equal(controller.match(/^\s*import\s/gm), null, "the controller imports nothing");
  });
});
