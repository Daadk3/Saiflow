"use client";

/* Approved mascot PNGs are sized by this page's CSS, not the image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState, type CSSProperties } from "react";
import {
  AGENTS,
  CATEGORIES,
  HOW_STEPS,
  TRUST_POINTS,
  type AgentCategoryId,
} from "./agents-data";
import "./agents.css";

type FilterId = "all" | AgentCategoryId;

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

export default function AgentsView({
  fontVariableClass,
}: {
  fontVariableClass: string;
}) {
  const [category, setCategory] = useState<FilterId>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AGENTS.filter((agent) => {
      if (category !== "all" && agent.category !== category) return false;
      if (!q) return true;
      return (
        matchesQuery(agent.nameAr, q) ||
        matchesQuery(agent.nameEn, q) ||
        matchesQuery(agent.descAr, q) ||
        matchesQuery(agent.descEn, q)
      );
    });
  }, [category, query]);

  return (
    <div className={`agents-page ${fontVariableClass}`} dir="rtl" lang="ar">
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

          <div className="agents-stage-slot">
            <div className="agents-stage-scale">
              <div className="agents-stage">
                <div className="agents-orb agents-orb-big">
                  <img
                    src="/agents/00-saiflow-plain.png"
                    alt=""
                    width={658}
                    height={648}
                  />
                </div>
                <div className="agents-orb agents-orb-s agents-orb-writer">
                  <img src="/agents/02-content-writer.png" alt="" width={900} height={900} />
                </div>
                <div className="agents-orb agents-orb-s agents-orb-sales">
                  <img src="/agents/03-sales.png" alt="" width={900} height={900} />
                </div>
                <div className="agents-orb agents-orb-s agents-orb-appointments">
                  <img src="/agents/06-appointments.png" alt="" width={900} height={900} />
                </div>
                <div className="agents-orb agents-orb-s agents-orb-books">
                  <img src="/agents/04-bookkeeping.png" alt="" width={900} height={900} />
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
            />
            {query.trim() === "" ? (
              <span className="agents-search-hint agents-en" lang="en" aria-hidden="true">
                Search agents
              </span>
            ) : null}
          </label>
        </div>

        <div id="agents-catalog" className="agents-grid">
          {visible.map((agent) => (
            <article
              key={agent.id}
              className={agent.featured ? "agents-card agents-card-first" : "agents-card"}
              style={{ "--c": agent.accent, "--c-ink": agent.accentInk } as CSSProperties}
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
                <img src={agent.image} alt="" width={900} height={900} />
              </div>
              <div className="agents-card-body">
                <div className="agents-name">
                  <h2>{agent.nameAr}</h2>
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
                {/* Informational only. These buttons do not open a product or take payment. */}
                <button type="button" className="agents-card-btn">
                  {agent.actionAr}
                  <span className="agents-card-btn-en">
                    {" · "}
                    <span className="agents-en" lang="en">
                      {agent.actionEn}
                    </span>
                  </span>
                </button>
              </div>
            </article>
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="agents-empty" role="status">
            لا يوجد وكيل مطابق.{" "}
            <span className="agents-en" lang="en">
              No matching agent.
            </span>
          </p>
        ) : null}

        <section id="how-it-works" className="agents-how" aria-labelledby="how-it-works-title">
          <h2 id="how-it-works-title">
            كيف يعمل؟{" "}
            <span className="agents-how-en">
              · <span className="agents-en" lang="en">How it works</span>
            </span>
          </h2>
          <p className="agents-how-sub">بدون برمجة وبدون اشتراك شهري، ثلاث خطوات فقط</p>
          <div className="agents-steps">
            {HOW_STEPS.map((step) => (
              <article key={step.n} className="agents-step">
                <div className="agents-step-num" style={{ background: step.color }}>
                  {step.n}
                </div>
                <h3>{step.title}</h3>
                {step.n === "٣" ? (
                  <p>
                    في <bdi>ChatGPT Projects</bdi> أو <bdi>Claude Projects</bdi> أو{" "}
                    <bdi>Gemini Gems</bdi>، ويبدأ العمل.
                  </p>
                ) : (
                  <p>{step.body}</p>
                )}
                <span className="agents-step-en agents-en" lang="en">
                  {step.en}
                </span>
              </article>
            ))}
          </div>
          <div className="agents-upg">
            <div className="agents-upg-title">
              قريبًا: اربط وكيلك بواتساب، ثم تيليجرام
              <small>
                ترقية مدفوعة اختيارية ·{" "}
                <span className="agents-en" lang="en">
                  Optional paid upgrade: WhatsApp first, then Telegram
                </span>
              </small>
            </div>
            <span className="agents-soon agents-en" lang="en">
              WhatsApp — coming later
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
