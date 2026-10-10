/**
 * Geidea Checkout v2 — callback signature verification.
 *
 * Geidea signs a callback over seven fields, in this order: our merchant
 * public key, the order amount with two decimals, the currency, the order id,
 * the status, our merchant reference, and the callback's timeStamp; then
 * HMAC-SHA256 with the API password, then Base64.
 *
 * As in the request-signature tests, the known-answer vectors were computed
 * with Python's `hmac` module and cross-checked with OpenSSL, so a pass means
 * the module reproduces the algorithm rather than node:crypto agreeing with
 * itself. Every credential here is a fixture.
 *
 * THE CONSTANT-TIME PATH IS OBSERVED, NOT ASSUMED. `node:crypto` is mocked
 * with a wrapper that records each `timingSafeEqual` call, and the signature
 * module is imported only after that, so the tests can assert both that the
 * comparison goes through `timingSafeEqual` and that a malformed signature
 * never reaches it.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as realCrypto from "node:crypto";
import type {
  CallbackSignatureInput,
  CallbackVerification,
} from "../lib/payments/geidea/signature.ts";

type SignatureModule = typeof import("../lib/payments/geidea/signature.ts");
let sig: SignatureModule;

/** Byte lengths of the two buffers each time timingSafeEqual runs. */
const timingCalls: { a: number; b: number }[] = [];

before(async () => {
  // Only the two names the signature module imports. Re-exporting the whole
  // namespace is not possible: `crypto.constants` is non-configurable and the
  // mock loader refuses to redefine it.
  mock.module("node:crypto", {
    namedExports: {
      createHmac: realCrypto.createHmac,
      timingSafeEqual: (a: Uint8Array, b: Uint8Array) => {
        timingCalls.push({ a: a.byteLength, b: b.byteLength });
        return realCrypto.timingSafeEqual(a, b);
      },
    },
  });
  sig = await import("../lib/payments/geidea/signature.ts");
});

beforeEach(() => {
  timingCalls.length = 0;
});

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------------ */
/* Fixtures — none of these is a real credential                       */
/* ------------------------------------------------------------------ */

const PUBLIC_KEY = "d1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b";
const PASSWORD = "unit-test-password-not-real";
const ORDER_ID = "3c0e2b5a-9d4f-4c1b-8e2a-6f7b8c9d0e1f";
const REF = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TIMESTAMP = "2026-09-21T12:35:10.1234567Z";

const input = (
  over: Partial<CallbackSignatureInput> = {}
): CallbackSignatureInput => ({
  merchantPublicKey: PUBLIC_KEY,
  amount: 19.99,
  currency: "SAR",
  orderId: ORDER_ID,
  status: "Success",
  merchantReferenceId: REF,
  timeStamp: TIMESTAMP,
  ...over,
});

/** Python + OpenSSL agreed on each of these. */
const VECTORS = [
  {
    name: "a paid SAR order",
    input: input(),
    data: `${PUBLIC_KEY}19.99SAR${ORDER_ID}Success${REF}${TIMESTAMP}`,
    signature: "3emO3dXo2WRXgsUTTTLV9hAucY7KA7mEDqn6Lfzh+xE=",
  },
  {
    name: "a failed EGP order with an integer amount and a non-UUID reference",
    input: input({
      amount: 1850,
      currency: "EGP",
      orderId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      status: "Failed",
      merchantReferenceId: "10",
      timeStamp: "2024-09-18T15:31:34Z",
    }),
    data: `${PUBLIC_KEY}1850.00EGP9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6dFailed102024-09-18T15:31:34Z`,
    signature: "7aOw23v+X3V50IFOUUdvwHNdh4Q1hR30dxeN8ohtrts=",
  },
];

const VALID = VECTORS[0].signature;

function reason(result: CallbackVerification): string {
  return result.ok ? "ok" : result.reason;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

describe("callback signature: seven fields, in Geidea's order, HMAC-SHA256, Base64", () => {
  test("the signed string matches each vector's data exactly", () => {
    for (const v of VECTORS) {
      assert.equal(sig.buildCallbackSignatureData(v.input), v.data, v.name);
    }
  });

  test("reproduces the independently computed vectors", () => {
    for (const v of VECTORS) {
      assert.equal(sig.signCallback(v.input, PASSWORD), v.signature, v.name);
    }
  });

  test("the callback recipe is not the request recipe", () => {
    // Same key, same first three fields, different string: a request
    // signature can never be replayed as a callback signature.
    const request = sig.signCreateSession(
      {
        merchantPublicKey: PUBLIC_KEY,
        amount: 19.99,
        currency: "SAR",
        merchantReferenceId: REF,
        timestamp: TIMESTAMP,
      },
      PASSWORD
    );
    assert.notEqual(sig.signCallback(input(), PASSWORD), request);
  });

  test("equivalent amounts sign identically", () => {
    const expected = sig.signCallback(input({ amount: 1850 }), PASSWORD);
    for (const amount of ["1850", "1850.0", "1850.00", 1850.0]) {
      assert.equal(sig.signCallback(input({ amount }), PASSWORD), expected);
    }
  });

  test("a missing password is refused", () => {
    for (const password of ["", undefined, null]) {
      assert.throws(
        () => sig.signCallback(input(), password as unknown as string),
        sig.GeideaSignatureError
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

describe("verifyCallbackSignature: success", () => {
  test("accepts each vector's signature", () => {
    for (const v of VECTORS) {
      assert.deepEqual(
        sig.verifyCallbackSignature(v.input, v.signature, PASSWORD),
        { ok: true },
        v.name
      );
    }
  });

  test("accepts the amount however Geidea happens to render it", () => {
    const expected = sig.signCallback(input({ amount: 1850 }), PASSWORD);
    for (const amount of [1850, "1850", "1850.00"]) {
      assert.equal(
        reason(sig.verifyCallbackSignature(input({ amount }), expected, PASSWORD)),
        "ok"
      );
    }
  });
});

describe("verifyCallbackSignature: failure", () => {
  test("any tampered field is a signature_mismatch", () => {
    const tampered: Partial<CallbackSignatureInput>[] = [
      { amount: 19.98 },
      { amount: 199.9 },
      { currency: "USD" },
      { orderId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" },
      { status: "Failed" },
      { merchantReferenceId: "7c9e6679-7425-40de-944b-e07fc1f90ae8" },
      { timeStamp: "2026-09-21T12:35:11.1234567Z" },
    ];
    for (const over of tampered) {
      assert.equal(
        reason(sig.verifyCallbackSignature(input(over), VALID, PASSWORD)),
        "signature_mismatch",
        JSON.stringify(over)
      );
    }
  });

  test("a signature made with another password is a signature_mismatch", () => {
    const other = sig.signCallback(input(), `${PASSWORD}-2`);
    assert.equal(reason(sig.verifyCallbackSignature(input(), other, PASSWORD)), "signature_mismatch");
  });

  test("a signature for another merchant's key is a signature_mismatch", () => {
    // The public key is ours, from configuration. A payload that was signed
    // for a different merchant does not verify no matter what it says.
    const otherMerchant = sig.signCallback(
      input({ merchantPublicKey: "0f0e0d0c-0b0a-4908-8706-050403020100" }),
      PASSWORD
    );
    assert.equal(
      reason(sig.verifyCallbackSignature(input(), otherMerchant, PASSWORD)),
      "signature_mismatch"
    );
  });

  test("a request signature offered as a callback signature is a signature_mismatch", () => {
    const request = sig.signCreateSession(
      {
        merchantPublicKey: PUBLIC_KEY,
        amount: 19.99,
        currency: "SAR",
        merchantReferenceId: REF,
        timestamp: TIMESTAMP,
      },
      PASSWORD
    );
    assert.equal(reason(sig.verifyCallbackSignature(input(), request, PASSWORD)), "signature_mismatch");
  });

  test("anything that is not 32 Base64 bytes is malformed_signature, without hashing", () => {
    const bad: unknown[] = [
      "",
      "abc",
      VALID.slice(0, 43), // padding stripped
      `${VALID}=`, // extra padding
      VALID.replace("=", "A"), // right length, wrong shape
      "3emO3dXo2WRXgsUTTTLV9hAucY7KA7mEDqn6Lfzh+xE", // 43 chars, no '='
      Buffer.alloc(31).toString("base64"), // 31 bytes: ends in "=="
      Buffer.alloc(33).toString("base64"), // 33 bytes: 44 chars, no '='
      ` ${VALID}`,
      `${VALID}\n`,
      VALID.toLowerCase() === VALID ? `${VALID}x` : VALID.replace(/[a-z]/, "!"),
      123,
      null,
      undefined,
      {},
      [VALID],
      Buffer.from(VALID, "base64"),
    ];
    for (const provided of bad) {
      assert.equal(
        reason(sig.verifyCallbackSignature(input(), provided, PASSWORD)),
        "malformed_signature",
        String(provided)
      );
    }
    assert.equal(timingCalls.length, 0, "a malformed signature must never reach the comparison");
  });

  test("a payload the recipe cannot format is malformed_fields, without comparing", () => {
    const bad: Partial<CallbackSignatureInput>[] = [
      { amount: 19.999 },
      { amount: "19.999" },
      { amount: 0 },
      { amount: -5 },
      { amount: "abc" },
      { currency: "sar" },
      { currency: "SA" },
      { orderId: "" },
      { orderId: "   " },
      { status: "" },
      { status: " Success" },
      { merchantReferenceId: "" },
      { timeStamp: "" },
      { timeStamp: `${TIMESTAMP} ` },
      { amount: undefined },
      { orderId: undefined },
      { status: 200 as unknown as string },
    ];
    for (const over of bad) {
      assert.equal(
        reason(sig.verifyCallbackSignature(input(over), VALID, PASSWORD)),
        "malformed_fields",
        JSON.stringify(over)
      );
    }
    assert.equal(timingCalls.length, 0, "malformed fields must never reach the comparison");
  });

  test("a non-object payload is malformed_fields", () => {
    for (const payload of [null, undefined, "x", 42]) {
      assert.equal(
        reason(
          sig.verifyCallbackSignature(
            payload as unknown as CallbackSignatureInput,
            VALID,
            PASSWORD
          )
        ),
        "malformed_fields"
      );
    }
  });

  test("our own misconfiguration throws instead of reporting a mismatch", () => {
    // A handler must not read "the callback was forged" when the truth is
    // "the server has no password". These are exceptions, not results.
    for (const password of ["", undefined, null]) {
      assert.throws(
        () => sig.verifyCallbackSignature(input(), VALID, password as unknown as string),
        sig.GeideaSignatureError
      );
    }
    for (const merchantPublicKey of ["", "  ", undefined]) {
      assert.throws(
        () => sig.verifyCallbackSignature(input({ merchantPublicKey }), VALID, PASSWORD),
        sig.GeideaSignatureError
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* The constant-time path                                              */
/* ------------------------------------------------------------------ */

describe("the comparison is constant-time", () => {
  test("a well-formed verification goes through timingSafeEqual exactly once, on 32 bytes each", () => {
    sig.verifyCallbackSignature(input(), VALID, PASSWORD);
    assert.deepEqual(timingCalls, [{ a: 32, b: 32 }]);

    timingCalls.length = 0;
    sig.verifyCallbackSignature(input({ status: "Failed" }), VALID, PASSWORD);
    assert.deepEqual(timingCalls, [{ a: 32, b: 32 }], "a mismatch is compared the same way");
  });

  test("safeEqualSignatures compares decoded bytes with timingSafeEqual", () => {
    assert.equal(sig.safeEqualSignatures(VALID, VALID), true);
    assert.equal(sig.safeEqualSignatures(VALID, VECTORS[1].signature), false);
    assert.deepEqual(timingCalls, [{ a: 32, b: 32 }, { a: 32, b: 32 }]);
  });

  test("safeEqualSignatures never throws and never compares a wrong shape", () => {
    for (const [a, b] of [
      [VALID, ""],
      ["", VALID],
      [VALID, VALID.slice(0, 43)],
      [VALID, Buffer.alloc(31).toString("base64")],
      ["not base64!", VALID],
    ]) {
      assert.equal(sig.safeEqualSignatures(a, b), false);
    }
    assert.equal(timingCalls.length, 0);
  });

  test("the source compares with timingSafeEqual and never with an equality operator", () => {
    const src = stripComments(read("lib/payments/geidea/signature.ts"));
    const start = src.indexOf("export function safeEqualSignatures");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.ok(body.includes("timingSafeEqual("), "must call timingSafeEqual");
    assert.ok(!/[!=]==?/.test(body), "no ==, ===, != or !== inside the comparison");
    assert.ok(!/\.(includes|startsWith|endsWith|localeCompare)\(/.test(body));

    const verify = src.slice(src.indexOf("export function verifyCallbackSignature"));
    assert.ok(verify.includes("safeEqualSignatures("), "verification must use the safe comparison");
    assert.ok(
      !/expected\s*[!=]==?|[!=]==?\s*expected|providedSignature\s*[!=]==?\s*expected/.test(verify),
      "the expected signature is never compared with an equality operator"
    );
  });
});

/* ------------------------------------------------------------------ */
/* Nothing leaks                                                       */
/* ------------------------------------------------------------------ */

describe("no signature, password or credential leaks from verification", () => {
  test("results carry a reason and nothing else", () => {
    const outcomes = [
      sig.verifyCallbackSignature(input(), VALID, PASSWORD),
      sig.verifyCallbackSignature(input({ status: "Failed" }), VALID, PASSWORD),
      sig.verifyCallbackSignature(input(), "garbage", PASSWORD),
      sig.verifyCallbackSignature(input({ currency: "sar" }), VALID, PASSWORD),
    ];
    for (const outcome of outcomes) {
      const text = JSON.stringify(outcome);
      assert.ok(!text.includes(VALID), "result leaked the signature");
      assert.ok(!text.includes(PASSWORD), "result leaked the password");
      assert.ok(!text.includes(PUBLIC_KEY), "result leaked the public key");
      assert.deepEqual(Object.keys(outcome).sort(), outcome.ok ? ["ok"] : ["ok", "reason"]);
    }
  });

  test("configuration errors name the problem, never the values", () => {
    const SECRET = "SECRET-x9-must-never-print";
    let caught: Error | undefined;
    try {
      sig.verifyCallbackSignature(input({ merchantPublicKey: "" }), VALID, SECRET);
    } catch (error) {
      caught = error as Error;
    }
    assert.ok(caught instanceof sig.GeideaSignatureError);
    assert.ok(!caught.message.includes(SECRET));
    assert.ok(!String(caught.stack).includes(SECRET));
    assert.ok(!caught.message.includes(VALID));
  });
});
