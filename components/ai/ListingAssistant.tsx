"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ProductCategory } from "@/lib/categories";

/**
 * AI Listing Assistant — optional, inline, human-in-the-loop.
 *
 * Hard rules this component enforces:
 * - Nothing is ever saved or published here. Accepted values are handed back
 *   to the ordinary form via callbacks; the creator still submits manually.
 * - No field is overwritten silently: replacing existing text always asks.
 * - Suggestions render as plain text. No HTML, no Markdown, no dangerouslySet.
 * - Sections with no storage destination are clearly labelled "suggestion
 *   only" and offer copy, never a false "applied" state.
 */

type Lang = "ar" | "en";

interface Suggestions {
  improvedTitle: string;
  shortSummary: string;
  fullDescription: string;
  keyBenefits: string[];
  targetAudience: string;
  faq: { question: string; answer: string }[];
  cta: string;
  seoTitle: string;
  seoDescription: string;
  suggestedCategory: ProductCategory;
}

type FieldKey = keyof Suggestions;

export default function ListingAssistant({
  shopId,
  title,
  category,
  currentDescription,
  onApplyTitle,
  onApplyDescription,
  onApplyCategory,
  onEvent,
}: {
  shopId: string | null;
  title: string;
  category: string;
  currentDescription: string;
  onApplyTitle: (v: string) => void;
  onApplyDescription: (v: string) => void;
  onApplyCategory: (v: ProductCategory) => void;
  onEvent?: (name: string, detail?: Record<string, unknown>) => void;
}) {
  const t = useTranslations("ai");

  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<Lang>("ar");
  const [audience, setAudience] = useState("");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [drafts, setDrafts] = useState<Suggestions | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  function emit(name: string, detail?: Record<string, unknown>) {
    onEvent?.(name, detail);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    emit(next ? "assistant_opened" : "assistant_dismissed");
  }

  async function generate(section?: FieldKey) {
    if (!shopId) return;
    setLoading(true);
    setError(null);
    emit("generation_requested", { language, section: section ?? "full" });

    try {
      const res = await fetch("/api/ai/listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId,
          language,
          category: category || "ebooks",
          title: title || "—",
          targetAudience: audience,
          details,
          ...(section ? { section } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(t(`errors.${data.error}`, { fallback: t("errors.PROVIDER_ERROR") }));
        emit("generation_failed", { code: data.error });
        return;
      }

      setIsLive(data.isLive !== false);
      setDrafts(data.suggestions);
      emit("generation_succeeded", { section: section ?? "full" });
      if (section) emit("field_regenerated", { field: section });
    } catch {
      setError(t("errors.PROVIDER_ERROR"));
      emit("generation_failed", { code: "NETWORK" });
    } finally {
      setLoading(false);
    }
  }

  function edit(field: FieldKey, value: string) {
    if (!drafts) return;
    setDrafts({ ...drafts, [field]: value });
    if (applied.has(field)) emit("field_edited_after_accept", { field });
  }

  /** Applies to the real form — asking first if it would replace existing text. */
  function apply(field: "improvedTitle" | "shortSummary" | "fullDescription" | "suggestedCategory") {
    if (!drafts) return;

    if (field === "suggestedCategory") {
      onApplyCategory(drafts.suggestedCategory);
    } else if (field === "improvedTitle") {
      if (title.trim() && title.trim() !== drafts.improvedTitle && !confirm(t("replaceConfirm"))) return;
      onApplyTitle(drafts.improvedTitle);
    } else {
      const value = field === "shortSummary" ? drafts.shortSummary : drafts.fullDescription;
      if (currentDescription.trim() && !confirm(t("replaceConfirm"))) return;
      onApplyDescription(value);
    }

    setApplied((prev) => new Set(prev).add(field));
    emit("field_accepted", { field });
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      /* clipboard unavailable — the text is on screen and selectable */
    }
  }

  function rejectAll() {
    setDrafts(null);
    setApplied(new Set());
    emit("assistant_dismissed", { reason: "reject_all" });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="w-full rounded-xl border border-dashed border-teal-500/40 bg-teal-500/[0.04] px-4 py-3 text-sm font-medium text-teal-300 transition-colors hover:bg-teal-500/10"
      >
        ✨ {t("open")}
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-teal-500/25 bg-teal-500/[0.04] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-teal-300">✨ {t("title")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">{t("optional")}</p>
        </div>
        <button type="button" onClick={toggle} className="text-xs text-gray-500 hover:text-gray-300">
          {t("close")}
        </button>
      </div>

      {/* Privacy disclosure — shown before any generation */}
      <div className="mt-4 rounded-lg border border-gray-800 bg-[#0d0d0d] p-3">
        <p className="text-[11px] font-medium text-gray-400">{t("privacy.heading")}</p>
        <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-gray-500">
          <li>• {t("privacy.external")}</li>
          <li>• {t("privacy.noPersonal")}</li>
          <li>• {t("privacy.noFiles")}</li>
          <li>• {t("privacy.review")}</li>
        </ul>
      </div>

      {/* Inputs */}
      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-400">{t("language")}</label>
          <div className="flex gap-2">
            {(["ar", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLanguage(l)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  language === l
                    ? "border-teal-500 bg-teal-500/10 text-teal-300"
                    : "border-gray-800 text-gray-400 hover:border-gray-700"
                }`}
              >
                {t(`lang.${l}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-400">{t("audience")}</label>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            maxLength={300}
            placeholder={t("audiencePlaceholder")}
            className="w-full rounded-lg border border-gray-800 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-teal-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-400">
            {t("details")}{" "}
            <span className="text-gray-600">({details.length}/5000)</span>
          </label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 5000))}
            rows={4}
            maxLength={5000}
            placeholder={t("detailsPlaceholder")}
            className="w-full resize-none rounded-lg border border-gray-800 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-teal-500 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => generate()}
          disabled={loading || !shopId || title.trim().length < 2}
          className="w-full rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? t("generating") : t("generate")}
        </button>
        {title.trim().length < 2 && (
          <p className="text-[11px] text-gray-600">{t("needTitle")}</p>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3">
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {drafts && (
        <div className="mt-5 space-y-3 border-t border-gray-800 pt-4">
          {!isLive && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-300">{t("mockNotice")}</p>
            </div>
          )}

          <Applicable
            label={t("fields.improvedTitle")} value={drafts.improvedTitle}
            onChange={(v) => edit("improvedTitle", v)}
            onApply={() => apply("improvedTitle")} onRegenerate={() => generate("improvedTitle")}
            appliedLabel={applied.has("improvedTitle") ? t("appliedBadge") : null}
            t={t}
          />
          <Applicable
            label={t("fields.shortSummary")} value={drafts.shortSummary} multiline
            onChange={(v) => edit("shortSummary", v)}
            onApply={() => apply("shortSummary")} onRegenerate={() => generate("shortSummary")}
            appliedLabel={applied.has("shortSummary") ? t("appliedBadge") : null}
            t={t}
          />
          <Applicable
            label={t("fields.fullDescription")} value={drafts.fullDescription} multiline rows={8}
            onChange={(v) => edit("fullDescription", v)}
            onApply={() => apply("fullDescription")} onRegenerate={() => generate("fullDescription")}
            appliedLabel={applied.has("fullDescription") ? t("appliedBadge") : null}
            t={t}
          />

          {/* Category */}
          <div className="rounded-lg border border-gray-800 bg-[#0d0d0d] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-400">{t("fields.suggestedCategory")}</span>
              <div className="flex items-center gap-2">
                <code className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                  {drafts.suggestedCategory}
                </code>
                {applied.has("suggestedCategory") ? (
                  <span className="text-[11px] text-teal-400">{t("appliedBadge")}</span>
                ) : (
                  <button type="button" onClick={() => apply("suggestedCategory")}
                    className="rounded border border-teal-500/40 px-2 py-1 text-[11px] text-teal-300 hover:bg-teal-500/10">
                    {t("apply")}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Suggestion-only sections — no storage destination in v1 */}
          <div className="rounded-lg border border-gray-800 bg-[#0d0d0d] p-3">
            <p className="text-[11px] font-medium text-gray-500">{t("suggestionOnly")}</p>

            <SuggestionOnly label={t("fields.keyBenefits")} text={drafts.keyBenefits.map((b) => `• ${b}`).join("\n")}
              copied={copied === "benefits"} onCopy={() => copy("benefits", drafts.keyBenefits.join("\n"))} t={t} />
            <SuggestionOnly label={t("fields.faq")}
              text={drafts.faq.map((f) => `${f.question}\n${f.answer}`).join("\n\n")}
              copied={copied === "faq"}
              onCopy={() => copy("faq", drafts.faq.map((f) => `${f.question}\n${f.answer}`).join("\n\n"))} t={t} />
            <SuggestionOnly label={t("fields.cta")} text={drafts.cta}
              copied={copied === "cta"} onCopy={() => copy("cta", drafts.cta)} t={t} />
            <SuggestionOnly label={t("fields.seoTitle")} text={drafts.seoTitle}
              copied={copied === "seoTitle"} onCopy={() => copy("seoTitle", drafts.seoTitle)} t={t} />
            <SuggestionOnly label={t("fields.seoDescription")} text={drafts.seoDescription}
              copied={copied === "seoDescription"} onCopy={() => copy("seoDescription", drafts.seoDescription)} t={t} />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={rejectAll}
              className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-700 hover:text-gray-200">
              {t("rejectAll")}
            </button>
            <button type="button" onClick={() => generate()} disabled={loading}
              className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-700 hover:text-gray-200 disabled:opacity-50">
              {t("regenerateAll")}
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-gray-600">{t("noAutoSave")}</p>
        </div>
      )}
    </section>
  );
}

function Applicable({
  label, value, multiline, rows = 3, onChange, onApply, onRegenerate, appliedLabel, t,
}: {
  label: string; value: string; multiline?: boolean; rows?: number;
  onChange: (v: string) => void; onApply: () => void; onRegenerate: () => void;
  appliedLabel: string | null; t: (k: string) => string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#0d0d0d] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        <div className="flex items-center gap-1.5">
          {appliedLabel && <span className="text-[11px] text-teal-400">{appliedLabel}</span>}
          <button type="button" onClick={onApply}
            className="rounded border border-teal-500/40 px-2 py-1 text-[11px] text-teal-300 hover:bg-teal-500/10">
            {appliedLabel ? t("reapply") : t("apply")}
          </button>
          <button type="button" onClick={onRegenerate}
            className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-400 hover:bg-white/5">
            {t("regenerate")}
          </button>
        </div>
      </div>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows}
          className="w-full resize-none rounded border border-gray-800 bg-[#0a0a0a] px-2.5 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-gray-800 bg-[#0a0a0a] px-2.5 py-2 text-sm text-gray-200 focus:border-teal-500 focus:outline-none" />
      )}
    </div>
  );
}

function SuggestionOnly({
  label, text, copied, onCopy, t,
}: { label: string; text: string; copied: boolean; onCopy: () => void; t: (k: string) => string }) {
  return (
    <div className="mt-2 border-t border-gray-800/60 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-gray-500">{label}</span>
        <button type="button" onClick={onCopy}
          className="text-[11px] text-gray-500 hover:text-gray-300">
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-400">{text}</p>
    </div>
  );
}
