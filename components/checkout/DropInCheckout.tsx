"use client";

import { useEffect, useRef, useState } from "react";
import { DropInPanel } from "./DropInPanel";
import { ATTEMPT_STORAGE_KEY } from "@/lib/checkout/embedded";
import { runLocked } from "@/lib/checkout/tab-lock";
import {
  createDropInController,
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
  const [state, setState] = useState<PanelState>({ kind: "starting" });
  const controller = useRef<DropInController | null>(null);
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // One controller per mounted page. Started from a scheduled callback, so
    // React's development double-mount disposes the first before it starts
    // and exactly one session is requested per page, in development and in
    // production alike.
    const instance = createDropInController(productId, scriptUrl, browserHost(), setState);
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
  }, [productId, scriptUrl]);

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
