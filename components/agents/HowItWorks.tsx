import { HOW_STEPS } from "./agents-data";

/** The three-step "How it works" panel, shared by the catalog and each agent page. */
export default function HowItWorks({ id = "how-it-works" }: { id?: string }) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="agents-how" aria-labelledby={titleId}>
      <h2 id={titleId}>
        كيف يعمل؟{" "}
        <span className="agents-how-en">
          · <span className="agents-en" lang="en">How it works</span>
        </span>
      </h2>
      <p className="agents-how-sub">
        هكذا سيعمل عند الإطلاق: بدون برمجة وبدون اشتراك شهري، ثلاث خطوات فقط
        {/* Own line, so the English never lands inside the Arabic sentence. */}
        <span className="agents-en" lang="en" style={{ display: "block" }}>
          How it will work at launch
        </span>
      </p>
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
        {/* No date, price or channel list until they are decided: WhatsApp
            waits on Meta business verification. */}
        <div className="agents-upg-title">
          لاحقًا: ربط الوكيل بواتساب
          <small>
            غير متاح بعد ·{" "}
            <span className="agents-en" lang="en">
              Later: connecting your agent to WhatsApp. Not available yet.
            </span>
          </small>
        </div>
        <span className="agents-soon">
          واتساب لاحقًا ·{" "}
          <span className="agents-en" lang="en">
            WhatsApp later
          </span>
        </span>
      </div>
    </section>
  );
}
