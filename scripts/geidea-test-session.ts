/**
 * One-off: create ONE Geidea TEST session for manual verification.
 *
 * What it does. Generates a fresh merchantReferenceId, asks Geidea for a
 * hosted-checkout session for 1.00 SAR through the application's own client
 * (`createSession` in lib/payments/geidea/client.ts, which signs the request
 * and authenticates exactly as the app will), and prints the four things a
 * person needs to complete the payment by hand and to recognise the callback
 * when it lands on the capture URL.
 *
 * The capture URL is the first command-line argument, never a constant in
 * this file: a capture token is a secret to whoever holds it, and a secret
 * does not belong in the repository. It must be https with a host. The
 * return URL is the same address with `leg=return` added, so the browser's
 * return leg is distinguishable from the server callback. Neither URL is
 * printed.
 *
 * What it never does. It creates no PaymentSession row and touches no
 * database. It prints no environment value, no credential, no Authorization
 * header, no request signature, no raw Geidea response and no URL. On
 * failure it prints the error's class, the client's own message (which by
 * construction names an operation, a status, a path or a code and nothing
 * else), the HTTP status and Geidea's short response codes. A non-Geidea
 * error is reported by name only.
 *
 * Guard rails. It refuses to run unless a valid capture URL is given, the
 * five GEIDEA_* variables are set, and GEIDEA_ENV is "test". The reference it
 * generates must never be seeded into SaiFlow: the callback this session
 * produces is captured externally, and the real callback route answers an
 * unknown reference with 404.
 *
 * How to run, once dependencies are installed and only when explicitly
 * approved, from the repository root:
 *
 *   node --env-file=.env.local --import ./tests/register.mjs \
 *     scripts/geidea-test-session.ts https://webhook.example.test/your-token
 *
 * `--env-file` loads .env.local into the process; `--import` registers the
 * repository's `@/` alias resolver, which the client's imports rely on.
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  createSession,
  geideaMode,
  isGeideaConfigured,
} from "@/lib/payments/geidea/client";

export const AMOUNT = "1.00";
export const CURRENCY = "SAR";
export const LANGUAGE = "en";

/** Geidea's documented KSA redirection format. */
const KSA_CHECKOUT_URL =
  /^https:\/\/www\.ksamerchant\.geidea\.net\/hpp\/checkout\/\?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Printer = (line: string) => void;

/** The capture URL from the caller, or null unless it is https with a host. */
export function resolveCallbackUrl(candidate: unknown): URL | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.length === 0) return null;
  return url;
}

/** The same capture with `leg=return`, so the browser's return is told apart. */
export function returnUrlFor(callbackUrl: URL): string {
  const url = new URL(callbackUrl.toString());
  url.searchParams.set("leg", "return");
  return url.toString();
}

/**
 * Exit code 0 on success, 1 when Geidea refused or could not be reached, 2
 * when the script itself refused to try.
 */
export async function run(
  callbackUrlArgument: unknown,
  print: Printer = (line) => console.log(line)
): Promise<number> {
  const callbackUrl = resolveCallbackUrl(callbackUrlArgument);
  if (callbackUrl === null) {
    print("REFUSED: pass the https capture URL as the first argument. It is never printed.");
    return 2;
  }
  if (!isGeideaConfigured()) {
    print("REFUSED: Geidea is not configured. Set the five GEIDEA_* variables in .env.local.");
    return 2;
  }
  if (geideaMode() !== "test") {
    print('REFUSED: GEIDEA_ENV is not "test". This script only ever creates TEST sessions.');
    return 2;
  }

  const merchantReferenceId = randomUUID();
  // Printed before the request, so a failure still shows which reference was
  // attempted and the capture can be matched to it.
  print(`merchantReferenceId: ${merchantReferenceId}`);

  try {
    const result = await createSession({
      amount: AMOUNT,
      currency: CURRENCY,
      merchantReferenceId,
      callbackUrl: callbackUrl.toString(),
      returnUrl: returnUrlFor(callbackUrl),
      language: LANGUAGE,
    });
    print(`sessionId:           ${result.session.sessionId}`);
    print(`expires:             ${result.session.expiryDate}`);
    print(`checkout URL:        ${result.redirectUrl}`);
    if (!KSA_CHECKOUT_URL.test(result.redirectUrl)) {
      print("WARNING: the checkout URL does not match Geidea's documented KSA format.");
    }
    return 0;
  } catch (error) {
    for (const line of describeFailure(error)) print(line);
    return 1;
  }
}

/**
 * Only what is safe by construction. The Geidea client's error messages carry
 * an operation, a status, a JSON path or short response codes, never a
 * header, a body or a credential; those are printed. Any other error could
 * quote anything, so only its name is.
 */
function describeFailure(error: unknown): string[] {
  const lines = ["FAILED"];
  if (!(error instanceof Error)) return [...lines, "  error: unknown"];
  lines.push(`  error: ${error.name}`);
  if (error.name.startsWith("Geidea")) lines.push(`  detail: ${error.message}`);
  const e = error as {
    status?: unknown;
    responseCode?: unknown;
    detailedResponseCode?: unknown;
  };
  if (typeof e.status === "number" && e.status > 0) lines.push(`  http status: ${e.status}`);
  if (typeof e.responseCode === "string") lines.push(`  responseCode: ${e.responseCode}`);
  if (typeof e.detailedResponseCode === "string") {
    lines.push(`  detailedResponseCode: ${e.detailedResponseCode}`);
  }
  return lines;
}

// Runs only when invoked directly, never when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv[2]);
}
