/**
 * Limited Illustrator support, behind a server-controlled switch.
 *
 * WHAT IS SUPPORTED when the switch is on: a DIRECT upload of a modern,
 * PDF-compatible `.ai` file. Such a file is a PDF by its bytes (lib/scan/sniff.ts:
 * `isIllustratorPdf`), so it travels the existing PDF policy unchanged: byte
 * sniff, PDF active-content tokens, provider scan with `restrictFileTypes=.pdf`,
 * and a content-verified `.pdf` from the provider. Nothing is relaxed for it.
 *
 * WHAT STAYS REFUSED regardless of the switch: EPS and every other PostScript
 * file, including legacy non-PDF-compatible `.ai` (sniffed `postscript`,
 * recorded `postscript_unsupported`); AI or EPS members inside a ZIP
 * (`archive_member_unsupported`, lib/scan/archive.ts); SVG anywhere.
 *
 * THE SWITCH defaults to off and is read on the server only. Off means:
 *   - the upload route does not list `application/postscript`, so the client
 *     refuses `.ai` and `.eps` before a byte is stored (lib/upload-config.ts);
 *   - a `.ai`-NAMED file that reaches the scanner anyway (a row uploaded while
 *     the switch was on, a server-side upload) settles UNSAFE
 *     `illustrator_disabled` instead of continuing to the provider.
 * The declared name is used here only to REFUSE, never to allow: with the
 * switch on, a `.ai` is still allowed only by what its bytes and the provider
 * say. Turning the switch on does not re-scan rows already settled.
 *
 * WHY A SWITCH AND NOT A LAUNCH: the provider's documented content-verification
 * list does not include `.ai`, and whether it returns `.pdf` for a PDF-compatible
 * Illustrator file submitted under a `.ai` filename is unverified
 * (docs/ILLUSTRATOR_SUPPORT.md). Until a Preview run proves the whole path, the
 * switch stays off and no public copy mentions AI.
 */

import type { ContentPolicy, PolicyVerdict } from "./policy";

/** Server environment variable. Only the exact value `on` enables anything. */
export const ILLUSTRATOR_SWITCH_ENV = "ILLUSTRATOR_PDF_UPLOADS";

export function illustratorUploadsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[ILLUSTRATOR_SWITCH_ENV]?.trim() === "on";
}

/** The uploader's declared name says Illustrator. A hint, usable only to refuse. */
export function isDeclaredIllustrator(fileName: string): boolean {
  return /\.ai$/i.test(fileName.trim());
}

/**
 * Applied after the structural pass and before the provider is asked.
 *
 * Only a `.ai`-named file under the PDF policy is affected, and only when the
 * switch is off. Everything else is ALLOW here and continues to the checks
 * that actually decide: a PDF named `.ai` with the switch on is still a PDF
 * that must pass the token search and the provider's `.pdf` verification, and
 * a `.ai` whose bytes are PostScript never reaches this function because it
 * has no policy at all.
 */
export function illustratorVerdict(
  fileName: string,
  policy: ContentPolicy,
  enabled: boolean
): PolicyVerdict {
  if (policy.kind !== "pdf") return { outcome: "ALLOW" };
  if (!isDeclaredIllustrator(fileName)) return { outcome: "ALLOW" };
  if (!enabled) return { outcome: "REJECT", reason: "illustrator_disabled" };
  return { outcome: "ALLOW" };
}
