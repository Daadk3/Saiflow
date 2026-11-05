"use client";

import { useTranslations } from "next-intl";
import { MAX_ACCESS_INSTRUCTIONS_LENGTH, MAX_ACCESS_URL_LENGTH } from "@/lib/hosted-access/limits";

/**
 * The seller's fields for a hosted-access product (e.g. an AI agent they
 * host): the private link buyers open and short access instructions.
 *
 * Presentation only. The server (lib/hosted-access/validate) is the gate and
 * says exactly what it refused; this just explains the rules up front.
 */
export function HostedAccessFields({
  accessUrl,
  onAccessUrl,
  instructions,
  onInstructions,
  certified,
  onCertified,
}: {
  accessUrl: string;
  onAccessUrl: (v: string) => void;
  instructions: string;
  onInstructions: (v: string) => void;
  certified: boolean;
  onCertified: (v: boolean) => void;
}) {
  const t = useTranslations("hostedAccess.seller");
  const looksHttps = accessUrl.trim() === "" || /^https:\/\//i.test(accessUrl.trim());
  return (
    <div className="space-y-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <div>
        <p className="text-sm font-semibold text-cyan-200">{t("title")}</p>
        <p className="mt-1 text-xs text-gray-400">{t("intro")}</p>
      </div>

      <div>
        <label htmlFor="accessUrl" className="block text-sm font-medium text-gray-300 mb-2">
          {t("urlLabel")} <span className="text-teal-400">*</span>
        </label>
        <input
          id="accessUrl"
          type="url"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_ACCESS_URL_LENGTH}
          value={accessUrl}
          onChange={(e) => onAccessUrl(e.target.value)}
          required
          placeholder="https://"
          aria-describedby="accessUrl-help"
          className="w-full px-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors"
        />
        <p id="accessUrl-help" className="mt-1 text-xs text-gray-500">{t("urlHelp")}</p>
        {!looksHttps && <p className="mt-1 text-xs text-amber-300">{t("urlHttps")}</p>}
      </div>

      <div>
        <label htmlFor="accessInstructions" className="block text-sm font-medium text-gray-300 mb-2">
          {t("instructionsLabel")}
        </label>
        <textarea
          id="accessInstructions"
          value={instructions}
          onChange={(e) => onInstructions(e.target.value)}
          rows={4}
          maxLength={MAX_ACCESS_INSTRUCTIONS_LENGTH}
          placeholder={t("instructionsPlaceholder")}
          aria-describedby="accessInstructions-help"
          className="w-full px-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors resize-none"
        />
        <p id="accessInstructions-help" className="mt-1 text-xs text-gray-500">
          {t("instructionsHelp", { max: MAX_ACCESS_INSTRUCTIONS_LENGTH, used: instructions.length })}
        </p>
      </div>

      <ul className="list-disc space-y-1 ps-5 text-xs text-gray-400">
        <li>{t("rulePrivate")}</li>
        <li>{t("ruleNoSecrets")}</li>
        <li>{t("ruleNoPatientData")}</li>
        <li>{t("ruleReview")}</li>
      </ul>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={certified}
          onChange={(e) => onCertified(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-gray-600 bg-[#0a0a0a] text-teal-500 focus:ring-teal-500"
        />
        <span className="text-sm text-gray-300 leading-relaxed">{t("certify")}</span>
      </label>
    </div>
  );
}
