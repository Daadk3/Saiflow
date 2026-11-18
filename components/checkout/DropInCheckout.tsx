"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { DropInPanel } from "./DropInPanel";
import { ATTEMPT_STORAGE_KEY } from "@/lib/checkout/embedded";
import { MAX_BUYER_EMAIL_LENGTH, normalizeBuyerEmail } from "@/lib/checkout/buyer-email";
import { MAX_BUYER_NAME_LENGTH, normalizeBuyerName } from "@/lib/checkout/buyer-name";
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
/** Per-tab memory of the receipt address and the buyer's name; never sent anywhere but checkout. */
const EMAIL_STORAGE_KEY = "saiflow.checkout.email";
const NAME_STORAGE_KEY = "saiflow.checkout.name";
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

/**
 * Whether Geidea's iframe has *loaded* in this mount's container.
 *
 * The element is inserted before its document has styles, so treating
 * "an iframe exists" as ready shows that first unstyled paint. `load`
 * means the hosted document finished loading; `error` or the existing
 * timeout means it did not, and the panel then shows the stuck notice
 * instead of leaving the veil up. The document inside the frame is never
 * read.
 */
function waitForFrame(containerId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    let watched: HTMLIFrameElement | null = null;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      resolve(loaded);
    };
    const watch = (frame: HTMLIFrameElement) => {
      if (watched === frame) return;
      watched = frame;
      frame.addEventListener("load", () => finish(true), { once: true });
      frame.addEventListener("error", () => finish(false), { once: true });
    };
    const tick = () => {
      if (settled) return;
      const frame = document.getElementById(containerId)?.querySelector("iframe");
      if (frame instanceof HTMLIFrameElement) watch(frame);
      if (Date.now() >= deadline) {
        finish(false);
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
  const [buyer, setBuyer] = useState<{ email: string; name: string } | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [state, setState] = useState<PanelState>({ kind: "starting" });
  const controller = useRef<DropInController | null>(null);
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (resumeIfReturning(productId, browserHost())) return;
    // This tab's last receipt address, so a reload only asks for a confirmation.
    const rememberedEmail = storage(() => window.sessionStorage.getItem(EMAIL_STORAGE_KEY), null);
    const rememberedName = storage(() => window.sessionStorage.getItem(NAME_STORAGE_KEY), null);
    const shown = window.setTimeout(() => {
      if (rememberedEmail !== null) setEmailDraft(rememberedEmail);
      if (rememberedName !== null) setNameDraft(rememberedName);
      setResumeChecked(true);
    }, 0);
    return () => window.clearTimeout(shown);
  }, [productId]);

  useEffect(() => {
    if (buyer === null) return;
    // One controller per mounted payment form. Started from a scheduled
    // callback, so React's development double-mount disposes the first
    // before it starts and exactly one session is requested per page, in
    // development and in production alike.
    const instance = createDropInController(productId, buyer.email, buyer.name, scriptUrl, browserHost(), setState);
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
  }, [productId, buyer, scriptUrl]);

  function submitBuyer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = normalizeBuyerEmail(emailDraft);
    const name = normalizeBuyerName(nameDraft);
    setEmailInvalid(email === null);
    setNameInvalid(name === null);
    if (email === null || name === null) return;
    storage(() => window.sessionStorage.setItem(EMAIL_STORAGE_KEY, email), undefined);
    storage(() => window.sessionStorage.setItem(NAME_STORAGE_KEY, name), undefined);
    setBuyer({ email, name });
  }

  if (!resumeChecked) {
    return <div className="h-40 animate-pulse rounded-2xl border border-teal-500/20 bg-[#101918]" aria-hidden="true" />;
  }

  if (buyer === null) {
    return (
      <form onSubmit={submitBuyer} noValidate className="rounded-2xl border border-teal-500/25 bg-[#101918] p-6 shadow-lg shadow-black/30">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="checkout-buyer-name" className="block text-sm font-medium text-white">
              {t("nameLabel")}
            </label>
            <p id="checkout-buyer-name-hint" className="mt-1 text-sm text-gray-400">
              {t("nameHint")}
            </p>
            <input
              id="checkout-buyer-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              maxLength={MAX_BUYER_NAME_LENGTH}
              value={nameDraft}
              onChange={(event) => {
                setNameDraft(event.target.value);
                if (nameInvalid) setNameInvalid(false);
              }}
              aria-invalid={nameInvalid}
              aria-describedby={nameInvalid ? "checkout-buyer-name-hint checkout-buyer-name-error" : "checkout-buyer-name-hint"}
              className="mt-3 w-full rounded-xl border border-teal-900 bg-[#071311] px-4 py-3 text-white placeholder-gray-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400/50"
            />
            {nameInvalid && (
              <p id="checkout-buyer-name-error" role="alert" className="mt-2 text-sm text-amber-400">
                {t("nameInvalid")}
              </p>
            )}
          </div>
          <div>
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
              value={emailDraft}
              onChange={(event) => {
                setEmailDraft(event.target.value);
                if (emailInvalid) setEmailInvalid(false);
              }}
              aria-invalid={emailInvalid}
              aria-describedby={emailInvalid ? "checkout-buyer-email-hint checkout-buyer-email-error" : "checkout-buyer-email-hint"}
              className="mt-3 w-full rounded-xl border border-teal-900 bg-[#071311] px-4 py-3 text-white placeholder-gray-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400/50"
              placeholder="name@example.com"
            />
            {emailInvalid && (
              <p id="checkout-buyer-email-error" role="alert" className="mt-2 text-sm text-amber-400">
                {t("emailInvalid")}
              </p>
            )}
          </div>
        </div>
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
