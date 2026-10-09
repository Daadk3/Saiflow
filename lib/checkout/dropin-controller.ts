/**
 * The embedded checkout's decisions, without React and without a browser.
 *
 * Everything the drop-in page decides lives here: when to ask for a session,
 * what to do when Geidea's library or form does not start, what Geidea's
 * callbacks may do, and when the hosted page may take over. The browser
 * (fetch, navigation, sessionStorage, the script tag, Geidea's constructor,
 * timers) is injected, so every rule below is tested as behaviour.
 *
 * NOTHING HERE IS PAYMENT AUTHORITY. A callback only moves the buyer; its
 * payload is never read. Whether anything was paid is answered by SaiFlow's
 * success page from SaiFlow's own rows, after the signed webhook, the
 * attempt comparison and the authenticated inquiry.
 *
 * ONE PAYABLE SESSION PER ATTEMPT. Every Geidea session can take money on
 * its own, so this page never asks for a second one because of anything the
 * browser saw. The server keeps one current attempt per browser and product
 * (lib/checkout/attempt); the page keeps to it:
 *
 *   before     Geidea's library loads before any session is requested.
 *              While nothing exists that could be paid, a library that will
 *              not load may still hand over to the hosted page.
 *   after      Once this page has asked for an embedded session, the hosted
 *              page is never offered. A form that does not appear, an error
 *              or a cancel offer the same session again (a reload, which the
 *              server answers with this browser's current attempt) and that
 *              attempt's status page; an expiry offers its status page only.
 *   elsewhere  When the server answers that this browser already has an
 *              attempt for the product that is paid, or that might still be,
 *              the buyer goes to that attempt's status page instead.
 *
 * ONE ASKER AT A TIME, UNDER ONE IDENTITY. The server starts nothing for a
 * request that holds no checkout identity: it issues one and the page asks
 * again. Every checkout request runs under a lock that all of this
 * browser's tabs share (lib/checkout/tab-lock), held from the first request
 * through the identity and the retry that creates or resumes the session.
 * So of two tabs opened at once, the first is issued the identity and
 * creates the attempt before the second asks at all, and the second then
 * presents the same identity and is answered from that attempt. Without
 * that lock no checkout request is sent at all, embedded or hosted: a
 * browser that offers no such lock, or refuses it, is told that checkout
 * cannot start safely here.
 *
 * THREE GUARDS, BECAUSE AN OUTCOME CAN ARRIVE AT ANY MOMENT.
 *
 *   settled    An embedded success, error or cancel, a committed hosted
 *              redirect, or a hand-over to an existing attempt's status page
 *              ends the choice of how to pay: the hosted page refuses to
 *              start afterwards, and a hosted reply that arrives afterwards
 *              is dropped, checked in the same tick as the navigation it
 *              would cause.
 *
 *   succeeded  Success always wins, and wins once. A success for THIS
 *              attempt takes the buyer to THIS attempt's status page even
 *              after an error or a cancel was reported: a buyer who has paid
 *              must reach their own status page, never a second payment
 *              form. A repeated success navigates nothing more. It is
 *              navigation only, to the server's own status path; the status
 *              page still says paid only once the verified Order exists.
 *
 *   disposed   The page that created this controller is gone. Every
 *              callback, reply, script load and timer that arrives afterwards
 *              does nothing at all: no navigation, no state, no storage.
 *
 * ONE CONTAINER PER PAGE. Each controller mints its own container id, hands
 * that id to Geidea's startPayment, and reads readiness from that element
 * alone, so an iframe meant for a page the buyer has left cannot count for
 * the page they are on.
 */

import type { LockOutcome } from "./tab-lock";
import {
  attemptConflictFrom,
  dropInContainerId,
  hasExpired,
  identityRequired,
  isHostedCheckoutUrl,
  parseDropInSession,
  resumePathFor,
  serializeAttempt,
  startProblemFor,
  type StartProblem,
} from "./embedded";

/** The drop-in session request, and the unchanged hosted-page request. */
export const DROPIN_REQUEST = "/api/checkout?presentation=dropin";
export const HOSTED_REQUEST = "/api/checkout";
/** How long to wait before asking once more while this browser's attempt is still being created. */
export const PENDING_RETRY_MS = 1_500;
/** The browser-wide lock every checkout request runs under, in every tab. */
export const CHECKOUT_LOCK = "saiflow-checkout";

/**
 * Every state the payment area can show. `statusPath` is the attempt's own
 * status page, present on every state that a session has reached.
 */
export type PanelState =
  | { kind: "starting" }
  | { kind: "ready"; expired: boolean; statusPath: string }
  | { kind: "confirming" }
  | { kind: "fallback" }
  | { kind: "redirecting" }
  | { kind: "stuck"; statusPath: string }
  | { kind: "cancelled"; statusPath: string }
  | { kind: "declined"; statusPath: string }
  | { kind: "unavailable"; problem: StartProblem };

export type GeideaCallback = (result: unknown) => void;

export interface GeideaCheckoutInstance {
  startPayment(sessionId: string, options: null, containerId: string): void;
}

export type GeideaCheckoutConstructor = new (
  onSuccess: GeideaCallback,
  onError: GeideaCallback,
  onCancel: GeideaCallback
) => GeideaCheckoutInstance;

export interface CheckoutReply {
  ok: boolean;
  status: number;
  /** The parsed JSON body, or null when it was not JSON. */
  body: unknown;
}

/** The browser, as the controller sees it. */
export interface DropInHost {
  /** POST JSON to SaiFlow's checkout route. Rejects only on transport failure. */
  post(url: string, body: { productId: string }): Promise<CheckoutReply>;
  navigate(url: string): void;
  replace(url: string): void;
  search(): string;
  readAttempt(): string | null;
  writeAttempt(value: string): void;
  clearAttempt(): void;
  loadScript(url: string): Promise<void>;
  geideaCheckout(): GeideaCheckoutConstructor | undefined;
  /** Resolves true once Geidea's iframe is in THIS container, false if it never appears there. */
  waitForFrame(containerId: string): Promise<boolean>;
  /** A random token for this mount's container id. */
  nonce(): string;
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /**
   * Run `task` holding the named lock, shared by every tab of this browser;
   * tasks wait their turn. Never runs `task` without the lock: resolves
   * `{ held: false }`, `task` uncalled, when the browser has no such lock or
   * refuses it.
   */
  withLock<T>(name: string, task: () => Promise<T>): Promise<LockOutcome<T>>;
}

export interface DropInController {
  /** This mount's own container id; nothing else on the page uses it. */
  readonly containerId: string;
  start(): Promise<void>;
  continueOnHostedPage(): Promise<void>;
  dispose(): void;
}

type Settlement = "embedded" | "hosted" | "elsewhere" | null;

/** Mounts in this document, so two ids can never coincide even if two tokens did. */
let mounts = 0;

/**
 * @param scriptUrl Geidea's library, as the page's server derived it from
 *   configuration; null when it cannot be served, which leaves only the
 *   hosted page.
 */
export function createDropInController(
  productId: string,
  scriptUrl: string | null,
  host: DropInHost,
  onState: (state: PanelState) => void
): DropInController {
  mounts += 1;
  const containerId = dropInContainerId(`${mounts}-${host.nonce()}`);
  let disposed = false;
  let settled: Settlement = null;
  let succeeded = false;
  let hostedInFlight = false;
  /** Set before the embedded request is sent: from then on a session may exist. */
  let sessionRequested = false;
  let expiryTimer: unknown = null;
  let current: PanelState = { kind: "starting" };

  const emit = (state: PanelState): void => {
    if (disposed) return;
    current = state;
    onState(state);
  };

  /** The hosted page, only while this page has never asked for an embedded session. */
  const offerHosted = (): void => {
    if (disposed || settled !== null || hostedInFlight || sessionRequested) return;
    emit({ kind: "fallback" });
  };

  /** This attempt's form could not be shown: the same session again, or its status page. */
  const stuck = (statusPath: string): void => {
    if (disposed || settled !== null) return;
    emit({ kind: "stuck", statusPath });
  };

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      host.setTimer(resolve, ms);
    });

  /**
   * One checkout request, answered, under the browser-wide checkout lock,
   * or no request at all. Null when the request has already ended this
   * page's part: the buyer was sent to an existing attempt's status page,
   * the page went away, or the problem is on screen.
   */
  async function requestSession(url: string): Promise<CheckoutReply | null> {
    let outcome: LockOutcome<CheckoutReply | null>;
    try {
      outcome = await host.withLock(CHECKOUT_LOCK, () => askForSession(url));
    } catch {
      // The lock call, or the request made under it, failed outright.
      // Nothing is retried, and nothing is ever sent outside the lock.
      if (!disposed && settled === null) emit({ kind: "unavailable", problem: "service" });
      return null;
    }
    if (!outcome.held) {
      // No lock, so no request: checkout cannot start safely in this browser.
      if (!disposed && settled === null) emit({ kind: "unavailable", problem: "lock_unavailable" });
      return null;
    }
    return outcome.value;
  }

  async function askForSession(url: string): Promise<CheckoutReply | null> {
    let identified = false;
    let waited = false;
    for (;;) {
      if (disposed || settled !== null) return null;
      let reply: CheckoutReply;
      try {
        reply = await host.post(url, { productId });
      } catch {
        if (!disposed && settled === null) emit({ kind: "unavailable", problem: "service" });
        return null;
      }
      if (disposed || settled !== null) return null;
      if (reply.ok) return reply;

      // Issued this browser's identity, and nothing was started. Once: a
      // browser that comes back without it is not keeping the cookie.
      if (identityRequired(reply.status, reply.body) && !identified) {
        identified = true;
        continue;
      }
      const conflict = attemptConflictFrom(reply.status, reply.body);
      if (conflict !== null && conflict.kind === "pending" && !waited) {
        waited = true;
        await wait(PENDING_RETRY_MS);
        continue;
      }
      if (conflict !== null && conflict.statusPath !== null) {
        settled = "elsewhere";
        host.replace(conflict.statusPath);
        return null;
      }
      emit({ kind: "unavailable", problem: startProblemFor(reply.status) });
      return null;
    }
  }

  async function start(): Promise<void> {
    if (disposed) return;

    const resumeTo = resumePathFor(host.search(), host.readAttempt(), productId, host.now());
    if (resumeTo !== null) {
      host.clearAttempt();
      host.replace(resumeTo);
      return;
    }

    // Geidea's library first, while nothing exists that could be paid.
    if (scriptUrl === null) {
      offerHosted();
      return;
    }
    try {
      await host.loadScript(scriptUrl);
    } catch {
      offerHosted();
      return;
    }
    if (disposed) return;
    const GeideaCheckout = host.geideaCheckout();
    if (typeof GeideaCheckout !== "function") {
      offerHosted();
      return;
    }

    // A new attempt, or this browser's current one, which the server
    // resumes as the very same Geidea session.
    sessionRequested = true;
    const reply = await requestSession(DROPIN_REQUEST);
    if (reply === null) return;
    const parsed = parseDropInSession(reply.body);
    if (parsed === null) {
      // Whatever the server meant, a session may exist now: not the hosted page.
      emit({ kind: "unavailable", problem: "service" });
      return;
    }
    host.writeAttempt(serializeAttempt({ productId, successPath: parsed.successPath, startedAt: host.now() }));
    if (parsed.scriptUrl !== scriptUrl) {
      stuck(parsed.successPath);
      return;
    }

    expiryTimer = host.setTimer(() => {
      if (disposed || current.kind !== "ready") return;
      emit({ ...current, expired: true });
    }, Math.max(0, parsed.expiresAt - host.now()));

    // Navigation only; the payload is never read. Success overrides an
    // earlier error or cancel for this same attempt; it navigates once.
    const onSuccess: GeideaCallback = () => {
      if (disposed || succeeded) return;
      succeeded = true;
      settled = "embedded";
      host.clearAttempt();
      emit({ kind: "confirming" });
      host.navigate(parsed.successPath);
    };
    const onError: GeideaCallback = () => {
      if (disposed || settled !== null) return;
      settled = "embedded";
      emit({ kind: "declined", statusPath: parsed.successPath });
    };
    const onCancel: GeideaCallback = () => {
      if (disposed || settled !== null) return;
      settled = "embedded";
      // Not a verdict: the status page, one tap away, is the authority.
      emit({ kind: "cancelled", statusPath: parsed.successPath });
    };

    try {
      new GeideaCheckout(onSuccess, onError, onCancel).startPayment(parsed.sessionId, null, containerId);
    } catch {
      stuck(parsed.successPath);
      return;
    }

    const framed = await host.waitForFrame(containerId);
    if (disposed || settled !== null) return;
    if (!framed) {
      stuck(parsed.successPath);
      return;
    }
    emit({ kind: "ready", expired: hasExpired(parsed.expiresAt, host.now()), statusPath: parsed.successPath });
  }

  /**
   * Geidea's hosted page, through the default route path. Only while this
   * page has never asked for an embedded session: after that, a hosted
   * session could be a second way to pay for the same thing.
   */
  async function continueOnHostedPage(): Promise<void> {
    if (disposed || settled !== null || hostedInFlight || sessionRequested) return;
    hostedInFlight = true;
    emit({ kind: "redirecting" });

    const reply = await requestSession(HOSTED_REQUEST);
    hostedInFlight = false;
    if (reply === null || disposed || settled !== null) return;

    const body = reply.body;
    const url = body !== null && typeof body === "object" ? (body as { url?: unknown }).url : undefined;
    if (!isHostedCheckoutUrl(url)) {
      emit({ kind: "unavailable", problem: "service" });
      return;
    }

    // Committed in the same tick as the check above: nothing can settle in between.
    settled = "hosted";
    host.navigate(url);
  }

  function dispose(): void {
    disposed = true;
    if (expiryTimer !== null) host.clearTimer(expiryTimer);
  }

  return { containerId, start, continueOnHostedPage, dispose };
}
