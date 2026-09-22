/**
 * The offline signature-check script, proven on synthetic captures.
 *
 * For each candidate recipe, a capture is signed under that recipe with a
 * fixture password, and the script must report MATCH for exactly that
 * candidate and NO MATCH for every other, including the two controls. The
 * env module is not loaded: `check()` takes the credentials as arguments.
 */

import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hmacSha256Base64, signCreateSession } from "../lib/payments/geidea/signature.ts";

// The script imports lib/env, which validates the whole server environment
// at import time. The check itself takes credentials as arguments, so the
// env module is replaced with an empty one before the script is loaded.
type CheckFn = typeof import("../scripts/geidea-callback-signature-check.ts")["check"];
let check: CheckFn;
before(async () => {
  mock.module("@/lib/env", { namedExports: { env: {} } });
  check = (await import("../scripts/geidea-callback-signature-check.ts")).check;
});

const PK = "d1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b";
const PW = "unit-test-password-not-real";
const ORDER_ID = "3f433da9-2d20-4243-4fd2-08df0df6399e";
const SESSION_ID = "043ad7ca-9e38-474e-f09e-08def275479c";
const REF = "5fde430a-4ed5-4876-9929-11871c32ff8b";
const TS = "09/21/2026 19:06:52";

/** The real capture's shape: amount written as 1.00, status Success, detailedStatus Paid. */
function capture(signature: string, amountText = "1.00"): string {
  return (
    `{"order":{"orderId":"${ORDER_ID}","amount":${amountText},"currency":"SAR","detailedStatus":"Paid","status":"Success",` +
    `"merchantPublicKey":"${PK}","merchantReferenceId":"${REF}","paymentMethod":{"maskedCardNumber":"446404******0007"},` +
    `"transactions":[{"type":"Pay","status":"Success","codes":{"responseCode":"000"}}],"isTest":true,"sessionId":"${SESSION_ID}"},` +
    `"signature":"${signature}","timeStamp":"${TS}","sessionId":"${SESSION_ID}"}`
  );
}

const data = (amount: string, status: string, id = ORDER_ID) => `${PK}${amount}SAR${id}${status}${REF}${TS}`;

function run(body: string): { code: number; lines: string[] } {
  const lines: string[] = [];
  const code = check(body, PK, PW, (line) => lines.push(line));
  return { code, lines };
}

const verdicts = (lines: string[]) =>
  Object.fromEntries(
    lines.filter((l) => / = (MATCH|NO MATCH|SKIPPED)/.test(l)).map((l) => l.split(/\s+= /).map((s) => s.trim()) as [string, string])
  );

describe("the offline check identifies the recipe that produced a signature", () => {
  test("order.status + canonical amount", () => {
    const { code, lines } = run(capture(hmacSha256Base64(data("1.00", "Success"), PW)));
    const v = verdicts(lines);
    assert.equal(v["order.status + canonical 2-decimal amount"], "MATCH");
    assert.equal(v["order.detailedStatus + canonical 2-decimal amount"], "NO MATCH");
    assert.equal(v["order.status + JavaScript number rendering"], "NO MATCH");
    assert.equal(v["CONTROL request recipe (no order id, no status)"], "NO MATCH");
    assert.equal(v["CONTROL sessionId in place of orderId"], "NO MATCH");
    assert.ok(lines.includes("existing verifier (order.status + canonical amount) accepts this callback: true"));
    assert.ok(lines.includes("candidates that matched: 1"));
    assert.equal(code, 0);
  });

  test("order.detailedStatus + canonical amount", () => {
    const { lines } = run(capture(hmacSha256Base64(data("1.00", "Paid"), PW)));
    const v = verdicts(lines);
    assert.equal(v["order.detailedStatus + canonical 2-decimal amount"], "MATCH");
    assert.equal(v["order.status + canonical 2-decimal amount"], "NO MATCH");
    assert.ok(lines.includes("existing verifier (order.status + canonical amount) accepts this callback: false"));
  });

  test("order.status + JavaScript number rendering", () => {
    const { lines } = run(capture(hmacSha256Base64(data("1", "Success"), PW)));
    const v = verdicts(lines);
    assert.equal(v["order.status + JavaScript number rendering"], "MATCH");
    assert.equal(v["order.status + canonical 2-decimal amount"], "NO MATCH");
  });

  test("raw text is tried only when it differs from the canonical rendering", () => {
    const { lines } = run(capture(hmacSha256Base64(data("1.0", "Success"), PW), "1.0"));
    const v = verdicts(lines);
    assert.equal(v["order.status + raw amount text from the body"], "MATCH");
    assert.ok(lines.includes("amount as written in the body: 1.0"));
    const { lines: same } = run(capture(hmacSha256Base64(data("1.00", "Success"), PW)));
    assert.ok(!Object.keys(verdicts(same)).some((k) => k.includes("raw amount text")));
  });

  test("the request recipe control is recognised", () => {
    const requestSig = signCreateSession(
      { merchantPublicKey: PK, amount: 1, currency: "SAR", merchantReferenceId: REF, timestamp: TS },
      PW
    );
    const { code, lines } = run(capture(requestSig));
    assert.equal(verdicts(lines)["CONTROL request recipe (no order id, no status)"], "MATCH");
    assert.equal(code, 0);
  });

  test("a signature matching nothing yields no MATCH and exit 1", () => {
    const { code, lines } = run(capture("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
    assert.ok(!lines.some((l) => l.endsWith("= MATCH")));
    assert.ok(lines.includes("candidates that matched: 0"));
    assert.equal(code, 1);
  });

  test("refuses non-JSON and captures missing the signed fields", () => {
    assert.equal(run("<html>").code, 2);
    assert.equal(run('{"order":{"amount":1}}').code, 2);
  });

  test("prints nothing sensitive", () => {
    const sig = hmacSha256Base64(data("1.00", "Success"), PW);
    const { lines } = run(capture(sig));
    const out = lines.join("\n");
    for (const value of [PW, PK, sig, ORDER_ID, REF, SESSION_ID, TS, "446404", "Success", "Paid"]) {
      assert.ok(!out.includes(value), `output leaked ${value.slice(0, 8)}`);
    }
  });

  test("the script contacts nothing and reads credentials only through lib/env", () => {
    const src = readFileSync(new URL("../scripts/geidea-callback-signature-check.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\bfetch\s*\(/.test(src));
    assert.ok(!src.includes("process.env"));
    assert.ok(!src.includes("@/lib/prisma"));
    assert.ok(!src.includes("@/lib/payments/geidea/client"));
    assert.equal((src.match(/console\.\w+/g) ?? []).length, 1);
  });
});
