"use client";

import { useId, useRef, useState } from "react";
import type { AgentsLocale } from "./agents-data";

type Status = "closed" | "idle" | "pending" | "ok" | "invalid" | "rate" | "error";

/**
 * "Notify me" for an agent that is not out yet. It starts as the card's
 * button; tapping it opens one email field. The address goes to
 * /api/agent-waitlist with the agent and the page language, and nothing is
 * sent to the person now. A repeat address gets the same success message.
 */
export default function AgentNotifyForm({
  agentSlug,
  locale,
  labelAr,
  labelEn,
  buttonClassName,
}: {
  agentSlug: string;
  locale: AgentsLocale;
  labelAr: string;
  labelEn: string;
  buttonClassName: string;
}) {
  const inputId = useId();
  const noteId = `${inputId}-note`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("closed");

  function open() {
    setStatus("idle");
    // Wait for the field to render, then put the cursor in it.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("pending");
    try {
      const res = await fetch("/api/agent-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, agentSlug, locale }),
      });
      if (res.ok) {
        setEmail("");
        setStatus("ok");
        return;
      }
      if (res.status === 400) setStatus("invalid");
      else if (res.status === 429) setStatus("rate");
      else setStatus("error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "closed") {
    return (
      <button type="button" className={buttonClassName} onClick={open}>
        {labelAr}
        <span className="agents-card-btn-en">
          {" · "}
          <span className="agents-en" lang="en">
            {labelEn}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="agents-notify">
      {status === "ok" ? null : (
        <form className="agents-notify-form" onSubmit={onSubmit}>
          <label htmlFor={inputId} className="agents-sr-only">
            بريدك الإلكتروني · Your email
          </label>
          <input
            ref={inputRef}
            id={inputId}
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-describedby={noteId}
            className="agents-notify-input"
          />
          <button type="submit" className={buttonClassName} disabled={status === "pending"}>
            {status === "pending" ? "جارٍ الحفظ…" : "أبلغني"}
            <span className="agents-card-btn-en">
              {" · "}
              <span className="agents-en" lang="en">
                {status === "pending" ? "Saving…" : "Notify"}
              </span>
            </span>
          </button>
        </form>
      )}
      <p className="agents-notify-status" aria-live="polite">
        {status === "ok" && (
          <span className="agents-notify-ok">
            تم! سنراسلك عند الإطلاق
            <span className="agents-en agents-notify-en" lang="en">
              Done! We&apos;ll email you at launch
            </span>
          </span>
        )}
        {status === "invalid" && (
          <>
            تحقق من البريد الإلكتروني
            <span className="agents-en agents-notify-en" lang="en">
              Please check the email
            </span>
          </>
        )}
        {status === "rate" && (
          <>
            محاولات كثيرة، حاول لاحقًا
            <span className="agents-en agents-notify-en" lang="en">
              Too many tries, try again later
            </span>
          </>
        )}
        {status === "error" && (
          <>
            تعذّر الحفظ، حاول مرة أخرى
            <span className="agents-en agents-notify-en" lang="en">
              Couldn&apos;t save, please try again
            </span>
          </>
        )}
      </p>
      <p id={noteId} className="agents-notify-note">
        نستخدم بريدك فقط لإبلاغك عند الإطلاق
        <span className="agents-en agents-notify-en" lang="en">
          We only use your email to tell you at launch.
        </span>
      </p>
    </div>
  );
}
