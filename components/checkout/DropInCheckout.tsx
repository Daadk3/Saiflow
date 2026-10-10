"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { DropInPanel } from "./DropInPanel";
import { ATTEMPT_STORAGE_KEY } from "@/lib/checkout/embedded";
import { MAX_BUYER_EMAIL_LENGTH, normalizeBuyerEmail } from "@/lib/checkout/buyer-email";
import { runLocked } from "@/lib/checkout/tab-lock";
import {
  createDropInController,
  resumeIfReturning,
  type DropInController,
  type DropInHost,
  type GeideaCheckoutConstructor,
  type PanelState,
} from "@/lib/checkout/dropin-controller";

/**
 * SaiFlow's embedded checkout: Geidea's Checkout v2 drop-in, inside SaiFlow's
 * page.
 *
 * CARD DATA NEVER TOUCHES SAIFLOW. The card number, CVV and expiry are typed
 * into Geidea's iframe, on Geidea's origin, and go to Geidea. This component
 * never renders a payment field, never reads the iframe, and never sees a
 * card token.
 *
 * This component only connects the browser to the controller in
 * lib/checkout/dropin-controller, which makes every decision and is tested
 * as behaviour: one controller per mounted page, disposed when the page
 * goes, so nothing a previous checkout's Geidea instance does later can
 * reach the page the buyer is on now.
 */

declare global {
  interface Window {
    GeideaCheckout?: GeideaCheckoutConstructor;
  }
}

const SCRIPT_TIMEOUT_MS = 12_000;
/** Per-tab memory of the receipt address; never sent anywhere but checkout. */
const EMAIL_STORAGE_KEY = "saiflow.checkout.email";
const MOUNT_TIMEOUT_MS = 12_000;

let scriptLoad: { url: string; promise: Promise<void> } | null = null;

/** Geidea's library, loaded once per page, from the URL the server derived. */
function loadGeideaScript(url: string): Promise<void> {
  if (typeof window.GeideaCheckout === "function") return Promise.resolve();
  if (scriptLoad !== null && scriptLoad.url === url) return scriptLoad.promise;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    const timer = window.setTimeout(() => reject(new Error("timeout")), SCRIPT_TIMEOUT_MS);
    script.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("load"));
    };
    document.head.appendChild(script);
  });
  scriptLoad = { url, promise };
  promise.catch(() => {
    if (scriptLoad?.promise === promise) scriptLoad = null;
  });
  return promise;
}

/** Whether Geidea's iframe has appeared in this mount's container. The iframe's contents are never read. */
function waitForFrame(containerId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (document.getElementById(containerId)?.querySelector("iframe")) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 200);
    };
    tick();
  });
}

/** A random token for a container id; unguessable is not required, only distinct. */
function randomToken(): string {
  try {
    return window.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * The browser's own cross-tab lock manager, the Web Locks API, or undefined.
 * Typed as always present, but absent in older browsers and outside a
 * secure context; lib/checkout/tab-lock sends no checkout request without
 * it.
 */
function browserLocks(): unknown {
  try {
    return window.navigator.locks;
  } catch {
    return undefined;
  }
}

/** Storage is a convenience for recovery; its absence changes nothing else. */
function storage<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

function browserHost(): DropInHost {
  return {
    post: async (url, body) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed: unknown = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, body: parsed };
    },
    navigate: (url) => window.location.assign(url),
    replace: (url) => window.location.replace(url),
    search: () => window.location.search,
    readAttempt: () => storage(() => window.sessionStorage.getItem(ATTEMPT_STORAGE_KEY), null),
    writeAttempt: (value) => storage(() => window.sessionStorage.setItem(ATTEMPT_STORAGE_KEY, value), undefined),
    clearAttempt: () => storage(() => window.sessionStorage.removeItem(ATTEMPT_STORAGE_KEY), undefined),
    loadScript: loadGeideaScript,
    geideaCheckout: () => window.GeideaCheckout,
    waitForFrame: (containerId) => waitForFrame(containerId, MOUNT_TIMEOUT_MS),
    nonce: randomToken,
    now: () => Date.now(),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    withLock: (name, task) => runLocked(browserLocks(), name, task),
  };
}

/**
 * The receipt address first, then the payment form.
 *
 * No session is asked for until the buyer has given an address the server
 * will accept, so every attempt carries one and every purchase can send its
 * receipt. A buyer arriving back from an embedded payment is sent to that
 * attempt's status page before anything is asked, exactly as the controller
 * would; the controller still applies the same rule when it starts.
 */
export function DropInCheckout({
  productId,
  productHref,
  scriptUrl,
}: {
  productId: string;
  productHref: string;
  /** Geidea's library, derived by the page's server from configuration; null if it cannot be served. */
  scriptUrl: string | null;
}) {
  const t = useTranslations("checkout");
  const [resumeChecked, setResumeChecked] = useState(false);
  const [buyerEmail, setBuyerEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [state, setState] = useState<PanelState>({ kind: "starting" });
  const controller = useRef<DropInController | null>(null);
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (resumeIfReturning(productId, browserHost())) return;
    // This tab's last receipt address, so a reload only asks for a confirmation.
    const remembered = storage(() => window.sessionStorage.getItem(EMAIL_STORAGE_KEY), null);
    const shown = window.setTimeout(() => {
      if (remembered !== null) setDraft(remembered);
      setResumeChecked(true);
    }, 0);
    return () => window.clearTimeout(shown);
  }, [productId]);

  useEffect(() => {
    if (buyerEmail === null) return;
    // One controller per mounted payment form. Started from a scheduled
    // callback, so React's development double-mount disposes the first
    // before it starts and exactly one session is requested per page, in
    // development and in production alike.
    const instance = createDropInController(productId, buyerEmail, scriptUrl, browserHost(), setState);
    controller.current = instance;
    // This mount's own container. Set here, after mount, rather than
    // rendered, so the server's HTML never carries an id the browser then
    // disagrees with; Geidea mounts into it and readiness is read from it.
    if (container.current !== null) container.current.id = instance.containerId;
    const kickoff = window.setTimeout(() => {
      void instance.start();
    }, 0);
    return () => {
      window.clearTimeout(kickoff);
      instance.dispose();
      if (controller.current === instance) controller.current = null;
    };
  }, [productId, buyerEmail, scriptUrl]);

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = normalizeBuyerEmail(draft);
    if (email === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    storage(() => window.sessionStorage.setItem(EMAIL_STORAGE_KEY, email), undefined);
    setBuyerEmail(email);
  }

  if (!resumeChecked) {
    return <div className="h-40 animate-pulse rounded-2xl border border-gray-800 bg-[#111111]" aria-hidden="true" />;
  }

  if (buyerEmail === null) {
    return (
      <form onSubmit={submitEmail} noValidate className="rounded-2xl border border-gray-800 bg-[#111111] p-6">
        <label htmlFor="checkout-buyer-email" className="block text-sm font-medium text-white">
          {t("emailLabel")}
        </label>
        <p id="checkout-buyer-email-hint" className="mt-1 text-sm text-gray-400">
          {t("emailHint")}
        </p>
        <input
          id="checkout-buyer-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          required
          maxLength={MAX_BUYER_EMAIL_LENGTH}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (invalid) setInvalid(false);
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? "checkout-buyer-email-hint checkout-buyer-email-error" : "checkout-buyer-email-hint"}
          className="mt-3 w-full rounded-xl border border-gray-700 bg-[#0a0a0a] px-4 py-3 text-white placeholder-gray-500 focus:border-teal-500 focus:outline-none"
          placeholder="name@example.com"
        />
        {invalid && (
          <p id="checkout-buyer-email-error" role="alert" className="mt-2 text-sm text-amber-400">
            {t("emailInvalid")}
          </p>
        )}
        <button
          type="submit"
          className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
        >
          {t("emailContinue")}
        </button>
      </form>
    );
  }

  return (
    <DropInPanel
      state={state}
      containerRef={container}
      productHref={productHref}
      onContinueHosted={() => void controller.current?.continueOnHostedPage()}
      // A reload, which the server answers with this browser's current
      // attempt: the same Geidea session while it can be paid, or that
      // attempt's status page. Never a second payable session.
      onRetry={() => window.location.reload()}
    />
  );
}
