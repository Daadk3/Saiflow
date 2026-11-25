"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AGENTS,
  CATEGORIES,
  TRUST_POINTS,
  filterAgents,
  mascotAlt,
  type AgentCategoryId,
  type AgentsLocale,
} from "./agents-data";
import HowItWorks from "./HowItWorks";
import Mascot from "./Mascot";
import "./agents.css";

type FilterId = "all" | AgentCategoryId;

/** Cards that enter the viewport together fade in this far apart. */
const STAGGER_MS = 80;
const MAX_STAGGER_MS = 320;

export default function AgentsView({
  fontVariableClass,
  locale = "ar",
}: {
  fontVariableClass: string;
  locale?: AgentsLocale;
}) {
  const [category, setCategory] = useState<FilterId>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => filterAgents(AGENTS, category, query), [category, query]);

  // Scroll reveal. Each card fades and slides in the first time it comes
  // into view; cards arriving together are staggered. A card that has been
  // revealed stays revealed when filters hide and show it again.
  const gridRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const revealedRef = useRef(revealed);
  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const pending = Array.from(grid.querySelectorAll<HTMLElement>("[data-agent]")).filter(
      (el) => !(el.dataset.agent! in revealedRef.current),
    );
    if (pending.length === 0) return;

    // With reduced motion the CSS shows every card as is; nothing to observe.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() =>
        setRevealed((prev) => {
          const next = { ...prev };
          for (const el of pending) next[el.dataset.agent!] = 0;
          return next;
        }),
      );
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target as HTMLElement)
          .sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order));
        if (entering.length === 0) return;
        for (const el of entering) observer.unobserve(el);
        setRevealed((prev) => {
          const next = { ...prev };
          entering.forEach((el, k) => {
            next[el.dataset.agent!] = Math.min(k * STAGGER_MS, MAX_STAGGER_MS);
          });
          return next;
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.12 },
    );
    for (const el of pending) observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div className={`agents-page ${fontVariableClass}`} dir="rtl" lang="ar">
      {/* Without JavaScript nothing would reveal the cards, so show them as drawn. */}
      <noscript>
        <style>{".agents-reveal{opacity:1!important;transform:none!important}"}</style>
      </noscript>
      <section className="agents-hero">
        <div className="agents-wrap agents-hero-grid">
          <div>
            <span className="agents-eyebrow">
              <span className="agents-eyebrow-dot" aria-hidden="true" />
              جديد على <span className="agents-en" lang="en">SaiFlow</span>
              {" · "}
              <span className="agents-en" lang="en">New</span>
            </span>
            <h1>
              وكلاء <span className="agents-grad agents-en" lang="en">SaiFlow</span> الأذكياء
            </h1>
            <div className="agents-h1en agents-en" lang="en">
              SaiFlow AI Agents
            </div>
            <p className="agents-lead">
              حمّل الوكيل، والصقه في <bdi>ChatGPT</bdi> أو <bdi>Claude</bdi> أو <bdi>Gemini</bdi>، ويبدأ العمل فورًا.
            </p>
            <p className="agents-leaden agents-en" lang="en">
              Download, paste into ChatGPT, Claude or Gemini, and it starts working.
            </p>
            <div className="agents-ctas">
              <a className="agents-btn agents-btn-mint" href="#agents-catalog">
                تصفّح الوكلاء
              </a>
              <a className="agents-btn agents-btn-ghost" href="#how-it-works">
                كيف يعمل؟
              </a>
            </div>
            <ul className="agents-trust">
              {TRUST_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>

          {/* Decorative group shot; each agent is named in its card below. */}
          <div className="agents-stage-slot" aria-hidden="true">
            <div className="agents-stage-scale">
              <div className="agents-stage">
                <div className="agents-orb agents-orb-big">
                  <Mascot
                    src="/agents/00-saiflow-plain.png"
                    alt=""
                    width={290}
                    index={0}
                    intrinsic={658}
                    intrinsicHeight={648}
                    priority
                  />
                </div>
                <div className="agents-orb agents-orb-s agents-orb-writer">
                  <Mascot src="/agents/02-content-writer.png" alt="" width={130} index={1} />
                </div>
                <div className="agents-orb agents-orb-s agents-orb-sales">
                  <Mascot src="/agents/03-sales.png" alt="" width={130} index={2} />
                </div>
                <div className="agents-orb agents-orb-s agents-orb-appointments">
                  <Mascot src="/agents/06-appointments.png" alt="" width={130} index={3} />
                </div>
                <div className="agents-orb agents-orb-s agents-orb-books">
                  <Mascot src="/agents/04-bookkeeping.png" alt="" width={130} index={4} />
                </div>
                <div className="agents-tag agents-tag-hello">
                  💬 «أهلًا! كيف أقدر أساعدك اليوم؟»
                </div>
                <div className="agents-tag agents-tag-works">
                  <b aria-hidden="true">● </b>
                  يعمل مع <bdi>ChatGPT · Claude · Gemini</bdi>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="agents-wrap">
        <div className="agents-filters">
          <div className="agents-chips" role="group" aria-label="تصفية الوكلاء">
            {CATEGORIES.map((item) => {
              const on = category === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={on ? "agents-chip agents-chip-on" : "agents-chip"}
                  aria-pressed={on}
                  aria-controls="agents-catalog"
                  onClick={() => setCategory(item.id)}
                >
                  {item.ar}{" "}
                  <small className="agents-en" lang="en">
                    {item.en}
                  </small>
                </button>
              );
            })}
          </div>
          <label className="agents-search">
            <span className="agents-search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث بين ٨ وكلاء…"
              aria-label="ابحث بين الوكلاء"
              aria-controls="agents-catalog"
              enterKeyHint="search"
            />
            {query.trim() === "" ? (
              <span className="agents-search-hint agents-en" lang="en" aria-hidden="true">
                Search agents
              </span>
            ) : null}
          </label>
        </div>

        <div id="agents-catalog" className="agents-grid" ref={gridRef}>
          {visible.map((agent, order) => {
            const delay = revealed[agent.id];
            const cardClass = [
              "agents-card",
              "agents-reveal",
              agent.featured ? "agents-card-first" : "",
              delay !== undefined ? "is-in" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const href = `/agents/${agent.id}`;
            return (
              <article
                key={agent.id}
                data-agent={agent.id}
                data-order={order}
                className={cardClass}
                style={
                  {
                    "--c": agent.accent,
                    "--c-ink": agent.accentInk,
                    "--reveal-delay": `${delay ?? 0}ms`,
                  } as CSSProperties
                }
              >
                <div className="agents-card-art">
                  <span className={agent.featured ? "agents-status agents-status-first" : "agents-status"}>
                    {agent.statusAr}
                    {" · "}
                    <span className="agents-en" lang="en">
                      {agent.statusEn}
                    </span>
                  </span>
                  {agent.featured ? <span className="agents-status-soon">متاح قريبًا</span> : null}
                  <Mascot
                    src={agent.image}
                    alt={mascotAlt(agent, locale)}
                    width={186}
                    index={AGENTS.indexOf(agent) + 5}
                    className="agents-card-mascot"
                  />
                </div>
                <div className="agents-card-body">
                  <div className="agents-name">
                    <h2>
                      <Link href={href} className="agents-name-link">
                        {agent.nameAr}
                      </Link>
                    </h2>
                    <span className="agents-name-en agents-en" lang="en">
                      {agent.nameEn}
                    </span>
                  </div>
                  <p className="agents-desc">{agent.descAr}</p>
                  <p className="agents-desc-en agents-en" lang="en">
                    {agent.descEn}
                  </p>
                  <div className="agents-spacer" />
                  <div className="agents-badges">
                    <span className="agents-badge">ChatGPT · Claude · Gemini</span>
                    <span className="agents-badge agents-badge-wa">WhatsApp — soon</span>
                  </div>
                  {agent.featured ? (
                    // Informational only. Launch sign-up is not built yet; this does not take payment.
                    <button type="button" className="agents-card-btn">
                      {agent.actionAr}
                      <span className="agents-card-btn-en">
                        {" · "}
                        <span className="agents-en" lang="en">
                          {agent.actionEn}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <Link href={href} className="agents-card-btn">
                      {agent.actionAr}
                      <span className="agents-card-btn-en">
                        {" · "}
                        <span className="agents-en" lang="en">
                          {agent.actionEn}
                        </span>
                      </span>
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {visible.length === 0 ? (
          <p className="agents-empty" role="status">
            لا يوجد وكيل مطابق.{" "}
            <span className="agents-en" lang="en">
              No matching agent.
            </span>
          </p>
        ) : null}

        <HowItWorks />
      </div>
    </div>
  );
}
