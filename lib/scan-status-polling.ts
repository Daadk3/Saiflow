/**
 * Live refresh of the seller's file state.
 *
 * The check runs on the server; the seller's page only shows its result. This
 * module decides WHEN that page should read the result again, so a file moves
 * from uploaded to scanning to passed or failed on screen without a manual
 * reload.
 *
 * Read-only by construction. Nothing here performs a request: the page hands
 * over its own reload (a GET of the shop payload) and this schedules it. It
 * cannot start a scan, retry one, or write anything, because there is no code
 * path through which it could.
 *
 * Bounded by construction:
 *   - it runs only while something is actually uploaded or scanning;
 *   - one reload at a time, never overlapping, on a cadence that slows down
 *     the longer a check takes (SCAN_POLL_CADENCE);
 *   - it gives up after SCAN_POLL_MAX_MS, the same window after which the
 *     server itself stops calling a file "scanning" (lib/seller-file-state)
 *     and reports a failed, retryable state instead.
 *
 * Framework-free so it can be tested with an injected clock and timers.
 */

export interface CadenceStep {
  /** This step applies while the loop has been running for LESS than this long. */
  untilMs: number;
  intervalMs: number;
}

/**
 * How often to reload, by how long the loop has been running.
 *
 * Most checks finish inside the first half minute, so that is where the
 * attention goes. A check still running after two minutes is polled gently
 * until the window closes. Left alone for the whole window this makes
 * 12 + 18 + 51 = 81 reloads, one at a time; tests/scan-status-polling.test.ts
 * pins that number.
 */
export const SCAN_POLL_CADENCE: readonly CadenceStep[] = [
  { untilMs: 30_000, intervalMs: 2_500 },
  { untilMs: 2 * 60_000, intervalMs: 5_000 },
  { untilMs: Infinity, intervalMs: 15_000 },
];

/**
 * Mirrors SCAN_WINDOW_MS in lib/seller-file-state.ts. Not imported: that
 * module is server-only (it reaches lib/scan/run and, through it, Prisma) and
 * this one ships to the browser. tests/scan-status-polling.test.ts keeps the
 * two equal.
 */
export const SCAN_POLL_MAX_MS = 15 * 60_000;

/** The delay before the next reload, given how long the loop has been running. */
export function pollIntervalAt(
  elapsedMs: number,
  cadence: readonly CadenceStep[] = SCAN_POLL_CADENCE
): number {
  for (const step of cadence) {
    if (elapsedMs < step.untilMs) return step.intervalMs;
  }
  return cadence[cadence.length - 1].intervalMs;
}

export type PollableStateName = "uploaded" | "scanning" | "passed" | "failed";

export interface PollableFileState {
  state: PollableStateName;
}

/** Whether a file is still being checked, i.e. its state can still change on its own. */
export function isScanInProgress(value: PollableFileState | null | undefined): boolean {
  return value?.state === "uploaded" || value?.state === "scanning";
}

/** Whether ANY listed file is still being checked. Passed and failed are final until the seller acts. */
export function hasScanInProgress(
  values: Iterable<PollableFileState | null | undefined>
): boolean {
  for (const value of values) {
    if (isScanInProgress(value)) return true;
  }
  return false;
}

export interface ScanPollerOptions {
  /**
   * The page's own read-only reload. Called with no arguments; its result is
   * ignored and a failure is simply retried at the next tick.
   */
  refresh: () => unknown;
  cadence?: readonly CadenceStep[];
  maxMs?: number;
  /**
   * Consulted at every tick. When true the reload is skipped (the tab is
   * hidden, say) while the window keeps elapsing.
   */
  isPaused?: () => boolean;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface ScanPoller {
  /**
   * Report the latest data. Starts the loop when a check is in progress and
   * stops it the moment none is. Reporting "in progress" again while running
   * changes nothing: the window and the cadence are counted from the first
   * start.
   */
  update(inProgress: boolean): void;
  /** Stop now and drop any pending reload. Safe to repeat; `update(true)` may start again later. */
  stop(): void;
  /** Whether a loop is currently running. */
  readonly active: boolean;
}

export function createScanPoller(options: ScanPollerOptions): ScanPoller {
  const cadence = options.cadence ?? SCAN_POLL_CADENCE;
  const maxMs = options.maxMs ?? SCAN_POLL_MAX_MS;
  const isPaused = options.isPaused ?? (() => false);
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const cancel =
    options.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let active = false;
  let startedAt = 0;
  let timer: unknown = null;
  let inFlight = false;

  const arm = () => {
    timer = schedule(tick, pollIntervalAt(now() - startedAt, cadence));
  };

  const stop = () => {
    active = false;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };

  function tick() {
    timer = null;
    if (!active) return;
    if (now() - startedAt >= maxMs) {
      // The window is over. Whatever the server said last is what the seller
      // sees until they reload or act. The server reports a check that is
      // this old as failed and retryable, so nothing is left spinning.
      stop();
      return;
    }
    if (inFlight || isPaused()) {
      arm();
      return;
    }
    inFlight = true;
    Promise.resolve()
      .then(() => options.refresh())
      .catch(() => undefined)
      .then(() => {
        inFlight = false;
        // Still wanted, and nothing else armed the next tick meanwhile (a
        // stop-and-restart during this reload arms its own).
        if (active && timer === null) arm();
      });
  }

  return {
    update(inProgress) {
      if (!inProgress) {
        stop();
        return;
      }
      if (active) return;
      active = true;
      startedAt = now();
      arm();
    },
    stop,
    get active() {
      return active;
    },
  };
}
