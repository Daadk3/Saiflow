/**
 * One-off, OFFLINE: which recipe produced the signature on a real callback?
 *
 * Reads a captured Geidea callback body from a local file, recomputes the
 * signature under each candidate recipe with the credentials in .env.local,
 * and prints MATCH or NO MATCH per candidate. It never contacts anything,
 * and it prints no credential, no signature, no key and no field of the
 * callback except the textual rendering of the amount, which is needed to
 * read the result.
 *
 * Candidates. The documented recipe is
 *   MerchantPublicKey + Amount + Currency + OrderId + Status
 *     + MerchantReferenceId + timeStamp
 * with two open questions the documentation does not settle: whether
 * "Status" is `order.status` or `order.detailedStatus`, and whether the
 * amount is the canonical two-decimal rendering, the raw text as it appears
 * in the body, or the JavaScript number's own rendering. Every combination
 * is tried, plus two controls that must NOT match: the request recipe, and a
 * seven-field string with the session id in place of the order id.
 *
 * Run, once, from the repository root:
 *
 *   node --env-file=.env.local --import ./tests/register.mjs \
 *     scripts/geidea-callback-signature-check.ts /path/to/captured-callback.json
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { env } from "@/lib/env";
import {
  buildCallbackSignatureData,
  hmacSha256Base64,
  safeEqualSignatures,
  signCreateSession,
} from "@/lib/payments/geidea/signature";

type Printer = (line: string) => void;

interface Candidate {
  label: string;
  data: string | null;
}

/** The amount exactly as written in the body, e.g. "1.00", or null. */
function rawAmountText(rawBody: string): string | null {
  const match = rawBody.match(/"amount"\s*:\s*("?)(-?\d+(?:\.\d+)?)\1/);
  return match ? match[2] : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function check(rawBody: string, publicKey: string, apiPassword: string, print: Printer): number {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    print("REFUSED: the file is not JSON.");
    return 2;
  }
  const top = (json ?? {}) as Record<string, unknown>;
  const order = (top.order ?? {}) as Record<string, unknown>;

  const signature = text(top.signature)?.trim() ?? null;
  const timeStamp = text(top.timeStamp);
  const orderId = text(order.orderId);
  const currency = text(order.currency);
  const status = text(order.status);
  const detailedStatus = text(order.detailedStatus);
  const merchantReferenceId = text(order.merchantReferenceId);
  const amountValue = order.amount;

  const missing = Object.entries({ signature, timeStamp, orderId, currency, status, merchantReferenceId })
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (missing.length > 0 || (typeof amountValue !== "number" && typeof amountValue !== "string")) {
    print(`REFUSED: the capture lacks ${[...missing, ...(typeof amountValue !== "number" && typeof amountValue !== "string" ? ["amount"] : [])].join(", ")}.`);
    return 2;
  }

  const rawText = rawAmountText(rawBody);
  const canonical = Number(amountValue).toFixed(2);
  const jsNumber = String(Number(amountValue));
  print(`amount as written in the body: ${rawText ?? "(not found)"}`);
  print(`signature has the 32-byte Base64 shape: ${/^[A-Za-z0-9+/]{43}=$/.test(signature!)}`);
  print("");

  const amounts: [string, string | null][] = [
    ["canonical 2-decimal amount", canonical],
    ["raw amount text from the body", rawText],
    ["JavaScript number rendering", jsNumber],
  ];
  const statuses: [string, string | null][] = [
    ["order.status", status],
    ["order.detailedStatus", detailedStatus],
  ];

  const candidates: Candidate[] = [];
  for (const [statusLabel, statusValue] of statuses) {
    for (const [amountLabel, amountText] of amounts) {
      const distinct = amountLabel === "canonical 2-decimal amount" || amountText !== canonical;
      if (!distinct) continue; // identical string to the canonical one: same result, skip
      candidates.push({
        label: `${statusLabel} + ${amountLabel}`,
        data:
          statusValue === null || amountText === null
            ? null
            : `${publicKey}${amountText}${currency}${orderId}${statusValue}${merchantReferenceId}${timeStamp}`,
      });
    }
  }
  // Controls: these must not match.
  candidates.push({
    label: "CONTROL request recipe (no order id, no status)",
    data: null,
  });
  candidates.push({
    label: "CONTROL sessionId in place of orderId",
    data:
      text(top.sessionId) === null
        ? null
        : `${publicKey}${canonical}${currency}${text(top.sessionId)}${status}${merchantReferenceId}${timeStamp}`,
  });

  let matches = 0;
  for (const candidate of candidates) {
    let computed: string | null;
    if (candidate.label.startsWith("CONTROL request recipe")) {
      computed = signCreateSession(
        { merchantPublicKey: publicKey, amount: amountValue, currency: currency!, merchantReferenceId: merchantReferenceId!, timestamp: timeStamp! },
        apiPassword
      );
    } else {
      computed = candidate.data === null ? null : hmacSha256Base64(candidate.data, apiPassword);
    }
    const verdict = computed === null ? "SKIPPED (field absent)" : safeEqualSignatures(computed, signature!) ? "MATCH" : "NO MATCH";
    if (verdict === "MATCH") matches++;
    print(`${candidate.label.padEnd(58)} = ${verdict}`);
  }

  // What the application's own verifier would say, through its real code path.
  const verifierData = buildCallbackSignatureData({
    merchantPublicKey: publicKey,
    amount: amountValue,
    currency: currency!,
    orderId: orderId!,
    status: status!,
    merchantReferenceId: merchantReferenceId!,
    timeStamp: timeStamp!,
  });
  const verifierAgrees = safeEqualSignatures(hmacSha256Base64(verifierData, apiPassword), signature!);
  print("");
  print(`existing verifier (order.status + canonical amount) accepts this callback: ${verifierAgrees}`);
  print(`candidates that matched: ${matches}`);
  return matches === 1 ? 0 : 1;
}

export function main(argv: string[], print: Printer = (line) => console.log(line)): number {
  const path = argv[0];
  if (!path) {
    print("usage: geidea-callback-signature-check.ts <path-to-captured-callback.json>");
    return 2;
  }
  const publicKey = env.GEIDEA_MERCHANT_PUBLIC_KEY;
  const apiPassword = env.GEIDEA_API_PASSWORD;
  if (!publicKey || !apiPassword) {
    print("REFUSED: GEIDEA_MERCHANT_PUBLIC_KEY and GEIDEA_API_PASSWORD must be set.");
    return 2;
  }
  let rawBody: string;
  try {
    rawBody = readFileSync(path, "utf8");
  } catch {
    print("REFUSED: could not read the capture file.");
    return 2;
  }
  return check(rawBody, publicKey, apiPassword, print);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
