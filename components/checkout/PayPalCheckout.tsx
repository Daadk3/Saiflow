"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MAX_BUYER_EMAIL_LENGTH, normalizeBuyerEmail } from "@/lib/checkout/buyer-email";
import { MAX_BUYER_NAME_LENGTH, normalizeBuyerName } from "@/lib/checkout/buyer-name";

/**
 * PayPal, offered below Geidea's card form as a second way to pay.
 *
 * Shown only when the server has decided PayPal may be offered for this
 * product (configured, gates passed). The buyer sees the USD amount before
 * opening PayPal. Nothing here decides money: the create-order route sets
 * the amount from the product row, and only the capture route (or PayPal's
 * webhook), after verifying PayPal's own answer, creates an Order. On
 * success the buyer lands on the same status page as a Geidea purchase.
 *
 * PayPal's JS SDK renders its own button and popup; no payment details
 * pass through SaiFlow's page.
 */

interface PayPalButtonsActions {
  resolve(): Promise<void>;
  reject(): Promise<void>;
}
interface PayPalApproveActions {
  restart(): Promise<void>;
}
interface PayPalButtonsInstance {
  render(container: HTMLElement): Promise<void>;
  close?(): Promise<void>;
}
interface PayPalNamespace {
  Buttons(options: {
    style?: Record<string, string | number | boolean>;
    onClick?: (data: unknown, actions: PayPalButtonsActions) => Promise<void> | void;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }, actions: PayPalApproveActions) => Promise<void>;
    onCancel?: () => void;
    onError?: (error: unknown) => void;
  }): PayPalButtonsInstance;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

const EMAIL_STORAGE_KEY = "saiflow.checkout.email";
const NAME_STORAGE_KEY = "saiflow.checkout.name";
const SDK_TIMEOUT_MS = 15_000;

let sdkLoad: { url: string; promise: Promise<void> } | null = null;

function loadPayPalSdk(url: string): Promise<void> {
  if (typeof window.paypal?.Buttons === "function") return Promise.resolve();
  if (sdkLoad !== null && sdkLoad.url === url) return sdkLoad.promise;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    const timer = window.setTimeout(() => reject(new Error("timeout")), SDK_TIMEOUT_MS);
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
  sdkLoad = { url, promise };
  promise.catch(() => {
    if (sdkLoad?.promise === promise) sdkLoad = null;
  });
  return promise;
}

function remembered(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function remember(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage is a convenience only.
  }
}

type Notice = "fill" | "cancelled" | "error" | "loadError" | null;

export function PayPalCheckout({
  productId,
  clientId,
  amountUsd,
  amountSar,
  sarPerUsd,
  sandbox,
}: {
  productId: string;
  /** PayPal's public client id, handed over by the page's server. */
  clientId: string;
  amountUsd: string;
  amountSar: string;
  sarPerUsd: string;
  sandbox: boolean;
}) {
  const t = useTranslations("checkout");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [sdkState, setSdkState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const buyer = useRef({ name: "", email: "" });
  const statusPath = useRef<string | null>(null);
  const container = useRef<HTMLDivElement | null>(null);

  function updateName(value: string) {
    buyer.current = { ...buyer.current, name: value };
    setName(value);
  }

  function updateEmail(value: string) {
    buyer.current = { ...buyer.current, email: value };
    setEmail(value);
  }

  /** Opens the PayPal section, prefilled with this tab's last name and receipt address. */
  function openPayPal() {
    if (!name) updateName(remembered(NAME_STORAGE_KEY));
    if (!email) updateEmail(remembered(EMAIL_STORAGE_KEY));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let instance: PayPalButtonsInstance | null = null;
    const params = new URLSearchParams({
      "client-id": clientId,
      currency: "USD",
      intent: "capture",
      components: "buttons",
      locale: locale === "en" ? "en_US" : "ar_SA",
    });
    const url = `https://www.paypal.com/sdk/js?${params.toString()}`;

    loadPayPalSdk(url)
      .then(async () => {
        if (cancelled || !window.paypal || container.current === null) return;
        instance = window.paypal.Buttons({
          style: { layout: "vertical", shape: "rect", color: "gold", label: "paypal", height: 45 },
          onClick: (_data, actions) => {
            const n = normalizeBuyerName(buyer.current.name);
            const e = normalizeBuyerEmail(buyer.current.email);
            if (n === null || e === null) {
              setNotice("fill");
              return actions.reject();
            }
            setNotice(null);
            remember(NAME_STORAGE_KEY, n);
            remember(EMAIL_STORAGE_KEY, e);
            return actions.resolve();
          },
          createOrder: async () => {
            const response = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ productId, buyerEmail: buyer.current.email, buyerName: buyer.current.name }),
            });
            const body = (await response.json().catch(() => null)) as { orderId?: string; statusPath?: string } | null;
            if (!response.ok || !body?.orderId) throw new Error("create_failed");
            statusPath.current = body.statusPath ?? null;
            return body.orderId;
          },
          onApprove: async (data, actions) => {
            setConfirming(true);
            const response = await fetch("/api/paypal/capture", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: data.orderID }),
            });
            const body = (await response.json().catch(() => null)) as { error?: string; statusPath?: string } | null;
            if (response.status === 422 && body?.error === "instrument_declined") {
              setConfirming(false);
              return actions.restart();
            }
            // The status page reads SaiFlow's own Order state: it is the truth
            // for a paid, pending or uncertain capture alike.
            const next = body?.statusPath ?? statusPath.current;
            if (next && response.status !== 409) {
              window.location.assign(next);
              return;
            }
            setConfirming(false);
            setNotice("error");
          },
          onCancel: () => setNotice("cancelled"),
          onError: () => {
            setConfirming(false);
            setNotice("error");
          },
        });
        await instance.render(container.current);
        if (!cancelled) setSdkState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setSdkState("error");
          setNotice("loadError");
        }
      });

    return () => {
      cancelled = true;
      void instance?.close?.().catch(() => undefined);
    };
  }, [open, clientId, locale, productId]);

  const inputClass =
    "mt-2 w-full rounded-xl border border-teal-900 bg-[#071311] px-4 py-3 text-white placeholder-gray-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400/50";

  return (
    <section aria-labelledby="checkout-pay-by-paypal" className="mt-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-teal-800/70" aria-hidden="true" />
        <span className="text-xs uppercase tracking-wide text-teal-100/60">{t("payPalOr")}</span>
        <span className="h-px flex-1 bg-teal-800/70" aria-hidden="true" />
      </div>

      <div className="rounded-2xl border border-teal-500/25 bg-[#101918] p-6 shadow-lg shadow-black/30">
        <h2 id="checkout-pay-by-paypal" className="text-base font-semibold text-white">
          {t("payPalTitle")}
        </h2>
        <p className="mt-2 text-sm text-teal-50">
          {t("payPalAmount", { usd: amountUsd })}
        </p>
        <p className="mt-1 text-xs text-gray-400">{t("payPalRate", { sar: amountSar, rate: sarPerUsd })}</p>

        {sandbox && (
          <p role="note" className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100/90">
            {t("payPalSandbox")}
          </p>
        )}

        {!open ? (
          <button
            type="button"
            onClick={openPayPal}
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-teal-500/40 bg-transparent px-5 py-3 text-sm font-semibold text-teal-50 transition-colors hover:border-teal-400 hover:bg-teal-500/10"
          >
            {t("payPalOpen")}
          </button>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-white">
                {t("nameLabel")}
                <input
                  type="text"
                  autoComplete="name"
                  maxLength={MAX_BUYER_NAME_LENGTH}
                  value={name}
                  onChange={(event) => updateName(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium text-white">
                {t("emailLabel")}
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  dir="ltr"
                  maxLength={MAX_BUYER_EMAIL_LENGTH}
                  value={email}
                  onChange={(event) => updateEmail(event.target.value)}
                  placeholder="name@example.com"
                  className={inputClass}
                />
              </label>
            </div>

            {sdkState === "loading" && (
              <div className="h-12 animate-pulse rounded-xl bg-teal-900/30" aria-label={t("payPalLoading")} />
            )}
            {confirming && (
              <p role="status" className="text-sm text-teal-100/80">
                {t("payPalConfirming")}
              </p>
            )}
            {/* PayPal renders its button here, on a light card so its brand colours read correctly. */}
            <div ref={container} className={sdkState === "ready" ? "rounded-xl bg-white p-3" : undefined} />

            {notice !== null && (
              <p role="alert" className="text-sm text-amber-400">
                {notice === "fill"
                  ? t("payPalFillFirst")
                  : notice === "cancelled"
                    ? t("payPalCancelled")
                    : notice === "loadError"
                      ? t("payPalLoadError")
                      : t("payPalError")}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
