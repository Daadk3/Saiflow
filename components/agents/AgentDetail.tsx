import Link from "next/link";
import type { CSSProperties } from "react";
import { AGENTS, getCategory, mascotAlt, type Agent, type AgentsLocale } from "./agents-data";
import HowItWorks from "./HowItWorks";
import Mascot from "./Mascot";
import RiggedMascot from "./RiggedMascot";
import { RIGS } from "./rigs";
import "./agents.css";

/**
 * One agent's page. It only repeats what the catalog card already says
 * (name, what it does, group, models, status) plus the shared How it works
 * steps. No chat, no WhatsApp, nothing to buy: every agent is still planned.
 */
export default function AgentDetail({
  agent,
  fontVariableClass,
  locale,
}: {
  agent: Agent;
  fontVariableClass: string;
  locale: AgentsLocale;
}) {
  const group = getCategory(agent.category);
  const index = AGENTS.indexOf(agent);

  return (
    <div className={`agents-page ${fontVariableClass}`} dir="rtl" lang="ar">
      <div className="agents-wrap agents-detail">
        <nav className="agents-crumbs" aria-label="مسار التنقل · Breadcrumb">
          <Link href="/agents" className="agents-back">
            <span aria-hidden="true">→</span> كل الوكلاء ·{" "}
            <span className="agents-en" lang="en">
              All agents
            </span>
          </Link>
        </nav>

        <article
          className={agent.featured ? "agents-detail-card agents-card-first" : "agents-detail-card"}
          style={{ "--c": agent.accent, "--c-ink": agent.accentInk } as CSSProperties}
          aria-labelledby="agent-title"
        >
          <div className="agents-detail-art">
            {RIGS[agent.id] ? (
              <RiggedMascot
                id={agent.id}
                rig={RIGS[agent.id]}
                width={260}
                label={mascotAlt(agent, locale)}
              />
            ) : (
              <Mascot
                src={agent.image}
                alt={mascotAlt(agent, locale)}
                width={260}
                index={index + 5}
                priority
              />
            )}
          </div>

          <div className="agents-detail-body">
            <div className="agents-detail-pills">
              <span className={agent.featured ? "agents-pill agents-status-first" : "agents-pill"}>
                {agent.statusAr} ·{" "}
                <span className="agents-en" lang="en">
                  {agent.statusEn}
                </span>
              </span>
              {agent.featured ? <span className="agents-pill agents-pill-soon">متاح قريبًا</span> : null}
            </div>

            <h1 id="agent-title" className="agents-detail-title">
              {agent.nameAr}
            </h1>
            <p className="agents-detail-title-en agents-en" lang="en">
              {agent.nameEn}
            </p>

            <dl className="agents-facts">
              <div className="agents-fact">
                <dt>
                  ماذا يفعل؟ ·{" "}
                  <span className="agents-en" lang="en">
                    What it does
                  </span>
                </dt>
                <dd>
                  <p className="agents-fact-ar">{agent.descAr}</p>
                  <p className="agents-fact-en agents-en" lang="en">
                    {agent.descEn}
                  </p>
                </dd>
              </div>

              <div className="agents-fact">
                <dt>
                  يعمل مع ·{" "}
                  <span className="agents-en" lang="en">
                    Works with
                  </span>
                </dt>
                <dd className="agents-badges">
                  <span className="agents-badge">ChatGPT · Claude · Gemini</span>
                  <span className="agents-badge agents-badge-wa">
                    واتساب لاحقًا ·{" "}
                    <span className="agents-en" lang="en">
                      WhatsApp later
                    </span>
                  </span>
                </dd>
              </div>

              <div className="agents-fact">
                <dt>
                  الفئة ·{" "}
                  <span className="agents-en" lang="en">
                    Category
                  </span>
                </dt>
                <dd>
                  {group.ar} ·{" "}
                  <span className="agents-en" lang="en">
                    {group.en}
                  </span>
                </dd>
              </div>

              <div className="agents-fact">
                <dt>
                  الحالة ·{" "}
                  <span className="agents-en" lang="en">
                    Status
                  </span>
                </dt>
                <dd>
                  {agent.featured ? (
                    <>
                      {agent.statusAr}، متاح قريبًا ·{" "}
                      <span className="agents-en" lang="en">
                        {agent.statusEn}, coming soon
                      </span>
                    </>
                  ) : (
                    <>
                      {agent.statusAr}، وغير متاح بعد ·{" "}
                      <span className="agents-en" lang="en">
                        {agent.statusEn}, not available yet
                      </span>
                    </>
                  )}
                </dd>
              </div>
            </dl>

            <Link href="/agents#agents-catalog" className="agents-btn agents-btn-ghost agents-detail-back">
              تصفّح الوكلاء ·{" "}
              <span className="agents-en" lang="en">
                Browse agents
              </span>
            </Link>
          </div>
        </article>

        <HowItWorks />
      </div>
    </div>
  );
}
