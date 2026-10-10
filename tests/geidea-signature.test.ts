/**
 * Geidea Checkout v2 — request signature.
 *
 * The recipe under test is Geidea's own, quoted from the Checkout v2 docs:
 * concatenate { MerchantPublicKey, Amount (2 decimals), Currency,
 * MerchantReferenceId, Timestamp } with no separators, HMAC-SHA256 it with the
 * Merchant API Password as the key, Base64 the result.
 *
 * THE KNOWN-ANSWER VECTORS BELOW WERE NOT PRODUCED BY THE CODE UNDER TEST.
 * They were computed with Python's `hmac` module and cross-checked with
 * `openssl dgst -sha256 -hmac`, so a pass means the module reproduces the
 * algorithm, not merely that node:crypto agrees with itself. Every key and
 * reference here is a fixture; none is a real Geidea credential.
 *
 * Nothing in this file touches the network, the database, or `process.env`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GeideaSignatureError,
  buildCreateSessionSignatureData,
  formatGeideaAmount,
  formatGeideaTimestamp,
  hmacSha256Base64,
  signCreateSession,
} from "../lib/payments/geidea/signature.ts";
import type { CreateSessionSignatureInput } from "../lib/payments/geidea/signature.ts";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * Source with block and whole-line comments removed, so that prose in a
 * header cannot trip an assertion that is about what the code does.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------------ */
/* Fixtures — none of these is a real credential                       */
/* ------------------------------------------------------------------ */

const PUBLIC_KEY = "d1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b";
const PASSWORD = "unit-test-password-not-real";
const REF = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TS = "2026/09/21 12:34:56";

const input = (
  over: Partial<CreateSessionSignatureInput> = {}
): CreateSessionSignatureInput => ({
  merchantPublicKey: PUBLIC_KEY,
  amount: 19.99,
  currency: "SAR",
  merchantReferenceId: REF,
  timestamp: TS,
  ...over,
});

/** Python + OpenSSL agreed on each of these. */
const VECTORS = [
  {
    name: "SAR purchase with UUID reference and Y/m/d H:i:s timestamp",
    input: input(),
    password: PASSWORD,
    data: `${PUBLIC_KEY}19.99SAR${REF}${TS}`,
    signature: "X+v37I5NvN2jmerPLnuEwgEQSXmyxQJd4vsizsHFzNM=",
  },
  {
    name: "sub-riyal amount and the docs' non-UUID reference shape",
    input: input({
      amount: "0.5",
      merchantReferenceId: "21036410062-3704648-12-2",
      timestamp: "2024/09/18 15:31:34",
    }),
    password: PASSWORD,
    data: `${PUBLIC_KEY}0.50SAR21036410062-3704648-12-22024/09/18 15:31:34`,
    signature: "iS38HyWy3qn66NcxpAET24nY3AydKXR1lgr6Wwbjx0I=",
  },
  {
    name: "integer amount, EGP, and the API reference's US-style timestamp",
    input: input({
      merchantPublicKey: "0f0e0d0c-0b0a-4908-8706-050403020100",
      amount: 1850,
      currency: "EGP",
      merchantReferenceId: "10",
      timestamp: "2/21/2024 5:16:48 AM",
    }),
    password: "another-fixture-password",
    data: "0f0e0d0c-0b0a-4908-8706-0504030201001850.00EGP102/21/2024 5:16:48 AM",
    signature: "pNr6SS6VCDuXm6GikEMS8RPlTM3ZVYz6I/y1QYGKh2g=",
  },
];

const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

function refuses(fn: () => unknown, pattern?: RegExp): GeideaSignatureError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof GeideaSignatureError, "must throw GeideaSignatureError");
  if (pattern) assert.match(caught.message, pattern);
  return caught;
}

/* ------------------------------------------------------------------ */
/* Amount formatting                                                    */
/* ------------------------------------------------------------------ */

describe("amount: exactly two decimals, never a rounded riyal", () => {
  test("numbers format to two decimals", () => {
    assert.equal(formatGeideaAmount(19.99), "19.99");
    assert.equal(formatGeideaAmount(49), "49.00");
    assert.equal(formatGeideaAmount(0.5), "0.50");
    assert.equal(formatGeideaAmount(1850), "1850.00");
    assert.equal(formatGeideaAmount(100.1), "100.10");
    assert.equal(formatGeideaAmount(12345678.9), "12345678.90");
  });

  test("decimal strings (a Prisma Decimal's toString) format to two decimals", () => {
    assert.equal(formatGeideaAmount("19.99"), "19.99");
    assert.equal(formatGeideaAmount("49"), "49.00");
    assert.equal(formatGeideaAmount("49.5"), "49.50");
    assert.equal(formatGeideaAmount("0.5"), "0.50");
    assert.equal(formatGeideaAmount("99999999.99"), "99999999.99");
  });

  test("binary floating-point noise is tolerated", () => {
    assert.equal(formatGeideaAmount(0.1 + 0.2), "0.30");
    assert.equal(formatGeideaAmount(1.1 * 3), "3.30");
    assert.equal(formatGeideaAmount(4.35 * 100 / 100), "4.35");
  });

  test("a genuine third decimal is refused, never rounded", () => {
    for (const amount of [19.999, 1.005, 0.001, "19.999", "1.005"]) {
      refuses(() => formatGeideaAmount(amount), /2 decimal/);
    }
  });

  test("non-positive amounts are refused", () => {
    for (const amount of [0, -1, -0.5, "0", "0.00", "0.0"]) {
      refuses(() => formatGeideaAmount(amount), /greater than zero/);
    }
  });

  test("non-finite numbers are refused", () => {
    for (const amount of [NaN, Infinity, -Infinity]) {
      refuses(() => formatGeideaAmount(amount), /finite/);
    }
  });

  test("an amount large enough to print in exponent form is refused", () => {
    refuses(() => formatGeideaAmount(1e15), /too large/);
    refuses(() => formatGeideaAmount(1e21), /too large/);
  });

  test("malformed strings are refused rather than coerced", () => {
    const bad = [
      "",
      " 19.99",
      "19.99 ",
      "1,000.00",
      "1e3",
      "19.",
      ".5",
      "00.5",
      "+19.99",
      "-19.99",
      "SAR 19.99",
      "19.99SAR",
      "١٩٫٩٩", // Arabic-Indic digits: refused, not transliterated
      "١٩.٩٩",
      "NaN",
      "Infinity",
    ];
    for (const amount of bad) {
      refuses(() => formatGeideaAmount(amount), /plain decimal string/);
    }
  });

  test("anything that is not a number or string is refused", () => {
    for (const amount of [null, undefined, {}, [], true, BigInt(19)]) {
      refuses(() => formatGeideaAmount(amount as unknown as number));
    }
  });
});

/* ------------------------------------------------------------------ */
/* Timestamp                                                           */
/* ------------------------------------------------------------------ */

describe("timestamp: Geidea's Y/m/d H:i:s, zero-padded, in UTC", () => {
  test("renders the documented shape", () => {
    assert.equal(
      formatGeideaTimestamp(new Date(Date.UTC(2024, 8, 18, 15, 31, 34))),
      "2024/09/18 15:31:34"
    );
  });

  test("pads every component", () => {
    assert.equal(
      formatGeideaTimestamp(new Date(Date.UTC(2026, 0, 1, 0, 0, 0))),
      "2026/01/01 00:00:00"
    );
    assert.equal(
      formatGeideaTimestamp(new Date(Date.UTC(2026, 8, 21, 7, 5, 9))),
      "2026/09/21 07:05:09"
    );
  });

  test("uses UTC, not the process timezone", () => {
    // 23:59:59 UTC on New Year's Eve is already New Year in Riyadh; the
    // output must say the UTC date regardless of where the test runs.
    assert.equal(
      formatGeideaTimestamp(new Date(Date.UTC(2025, 11, 31, 23, 59, 59))),
      "2025/12/31 23:59:59"
    );
  });

  test("refuses an invalid or missing Date", () => {
    refuses(() => formatGeideaTimestamp(new Date("not a date")), /valid Date/);
    refuses(() => formatGeideaTimestamp("2026/09/21 12:34:56" as unknown as Date));
    refuses(() => formatGeideaTimestamp(undefined as unknown as Date));
  });
});

/* ------------------------------------------------------------------ */
/* The signed string                                                   */
/* ------------------------------------------------------------------ */

describe("the signed string is the five fields, in Geidea's order, with nothing between", () => {
  test("concatenation matches each vector's data exactly", () => {
    for (const v of VECTORS) {
      assert.equal(buildCreateSessionSignatureData(v.input), v.data, v.name);
    }
  });

  test("its length is the sum of the parts: no separator was inserted", () => {
    const data = buildCreateSessionSignatureData(input());
    assert.equal(
      data.length,
      PUBLIC_KEY.length + "19.99".length + "SAR".length + REF.length + TS.length
    );
  });

  test("the amount is normalised inside the string", () => {
    assert.ok(buildCreateSessionSignatureData(input({ amount: 19.9 })).includes("19.90SAR"));
    assert.ok(buildCreateSessionSignatureData(input({ amount: "19.9" })).includes("19.90SAR"));
    assert.ok(buildCreateSessionSignatureData(input({ amount: 5 })).includes("5.00SAR"));
  });

  test("currency must be a 3-letter uppercase code", () => {
    for (const currency of ["sar", "Sar", "SA", "SAUD", "SAR ", " SAR", "S4R", "ريال"]) {
      refuses(() => buildCreateSessionSignatureData(input({ currency })), /currency/);
    }
  });

  test("every text field must be present and untrimmed", () => {
    const fields = ["merchantPublicKey", "merchantReferenceId", "timestamp"] as const;
    for (const field of fields) {
      for (const value of ["", "   ", ` ${input()[field]}`, `${input()[field]}\n`]) {
        refuses(
          () => buildCreateSessionSignatureData(input({ [field]: value })),
          new RegExp(field)
        );
      }
      refuses(
        () => buildCreateSessionSignatureData(input({ [field]: undefined })),
        new RegExp(field)
      );
    }
  });

  test("a non-object input is refused", () => {
    refuses(() => buildCreateSessionSignatureData(null as unknown as CreateSessionSignatureInput));
    refuses(() => buildCreateSessionSignatureData("x" as unknown as CreateSessionSignatureInput));
  });
});

/* ------------------------------------------------------------------ */
/* HMAC-SHA256 + Base64                                                */
/* ------------------------------------------------------------------ */

describe("signature: Base64(HMAC-SHA256(apiPassword, data))", () => {
  test("reproduces the independently computed vectors", () => {
    for (const v of VECTORS) {
      assert.equal(signCreateSession(v.input, v.password), v.signature, v.name);
    }
  });

  test("the primitive alone reproduces a vector from its data string", () => {
    assert.equal(hmacSha256Base64(VECTORS[0].data, PASSWORD), VECTORS[0].signature);
  });

  test("output is the Base64 of a 32-byte digest", () => {
    const sig = signCreateSession(input(), PASSWORD);
    assert.match(sig, BASE64_32_BYTES);
    assert.equal(Buffer.from(sig, "base64").length, 32);
  });

  test("is deterministic", () => {
    assert.equal(signCreateSession(input(), PASSWORD), signCreateSession(input(), PASSWORD));
  });

  test("changing any single field changes the signature", () => {
    const base = signCreateSession(input(), PASSWORD);
    const variants: Partial<CreateSessionSignatureInput>[] = [
      { merchantPublicKey: "d1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5c" },
      { amount: 19.98 },
      { amount: 20 },
      { currency: "EGP" },
      { merchantReferenceId: "7c9e6679-7425-40de-944b-e07fc1f90ae8" },
      { timestamp: "2026/09/21 12:34:57" },
    ];
    for (const over of variants) {
      assert.notEqual(signCreateSession(input(over), PASSWORD), base, JSON.stringify(over));
    }
  });

  test("changing the password changes the signature", () => {
    assert.notEqual(
      signCreateSession(input(), PASSWORD),
      signCreateSession(input(), `${PASSWORD}-2`)
    );
  });

  test("equivalent amounts sign identically", () => {
    const expected = signCreateSession(input({ amount: 19.9 }), PASSWORD);
    for (const amount of ["19.9", "19.90", 19.9, 19.90]) {
      assert.equal(signCreateSession(input({ amount }), PASSWORD), expected);
    }
  });

  test("a missing password is refused before anything is hashed", () => {
    for (const password of ["", undefined, null, 42]) {
      refuses(() => signCreateSession(input(), password as unknown as string), /apiPassword/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The secret cannot leak through this module                          */
/* ------------------------------------------------------------------ */

describe("the API password cannot leak through this module", () => {
  const SECRET = "SECRET-x9-must-never-print";

  test("no error message echoes the password", () => {
    const attempts: (() => unknown)[] = [
      () => signCreateSession(input({ currency: "sar" }), SECRET),
      () => signCreateSession(input({ amount: 19.999 }), SECRET),
      () => signCreateSession(input({ merchantReferenceId: "" }), SECRET),
      () => signCreateSession(input({ timestamp: " " }), SECRET),
      () => signCreateSession(null as unknown as CreateSessionSignatureInput, SECRET),
    ];
    for (const attempt of attempts) {
      const error = refuses(attempt);
      assert.ok(!error.message.includes(SECRET), "message leaked the password");
      assert.ok(!String(error.stack).includes(SECRET), "stack leaked the password");
    }
  });

  test("no error message echoes an input value either", () => {
    const error = refuses(() =>
      signCreateSession(input({ merchantPublicKey: "  leaky-public-key  " }), SECRET)
    );
    assert.ok(!error.message.includes("leaky-public-key"));
  });

  test("the module is pure: no env, no logging, no network", () => {
    // The header is allowed to SAY the module never reads process.env; the
    // code is what must not do it, so comments come off before the check.
    const src = stripComments(read("lib/payments/geidea/signature.ts"));
    assert.ok(!src.includes("process.env"), "must not read the environment");
    assert.ok(!src.includes("console."), "must not log");
    assert.ok(!/\bfetch\s*\(/.test(src), "must not make requests");
    assert.ok(!src.includes("@/lib/prisma"), "must not touch the database");
    assert.deepEqual(
      src.match(/^import .*$/gm),
      ['import { createHmac, timingSafeEqual } from "node:crypto";'],
      "node:crypto must be the only import"
    );
  });

  test("the secret is a separate argument, never a field of the signed input", () => {
    const src = read("lib/payments/geidea/signature.ts");
    const iface = src.slice(
      src.indexOf("export interface CreateSessionSignatureInput"),
      src.indexOf("}", src.indexOf("export interface CreateSessionSignatureInput"))
    );
    assert.ok(!/password/i.test(iface), "the input type must not carry the password");
  });
});

/* ------------------------------------------------------------------ */
/* The env surface stays server-side and undisclosed                   */
/* ------------------------------------------------------------------ */

describe("the Geidea env surface is server-side only and never committed", () => {
  const NAMES = [
    "GEIDEA_MERCHANT_PUBLIC_KEY",
    "GEIDEA_API_PASSWORD",
    "GEIDEA_API_BASE_URL",
    "GEIDEA_HPP_BASE_URL",
    "GEIDEA_ENV",
  ];
  const env = read("lib/env.ts");
  const server = env.slice(env.indexOf("server: {"), env.indexOf("client: {"));
  const client = env.slice(env.indexOf("client: {"), env.indexOf("runtimeEnv: {"));
  const runtime = env.slice(env.indexOf("runtimeEnv: {"));

  test("every variable is declared in the server schema", () => {
    for (const name of NAMES) {
      assert.match(server, new RegExp(`^\\s*${name}:`, "m"), name);
    }
  });

  test("none is declared in the client schema, and none has a NEXT_PUBLIC_ twin", () => {
    for (const name of NAMES) {
      assert.ok(!client.includes(name), `${name} must not be client-visible`);
    }
    assert.ok(!env.includes("NEXT_PUBLIC_GEIDEA"), "no Geidea value may be public");
  });

  test("every variable is wired from process.env in runtimeEnv", () => {
    for (const name of NAMES) {
      assert.ok(runtime.includes(`${name}: process.env.${name}`), name);
    }
  });

  test("the credentials are optional, so pre-launch builds still validate", () => {
    assert.match(server, /GEIDEA_MERCHANT_PUBLIC_KEY: z\.string\(\)\.min\(1\)\.optional\(\)/);
    assert.match(server, /GEIDEA_API_PASSWORD: z\.string\(\)\.min\(1\)\.optional\(\)/);
  });

  test("GEIDEA_ENV is explicit: two allowed values and no default", () => {
    assert.match(server, /GEIDEA_ENV: z\.enum\(\["test", "production"\]\)\.optional\(\)/);
    const line = server.split("\n").find((l) => l.includes("GEIDEA_ENV:")) ?? "";
    assert.ok(!line.includes(".default("), "no default: a deployment must state its mode");
  });

  test(".env.example lists each name with an empty value — never a real one", () => {
    const example = read(".env.example");
    for (const name of NAMES) {
      assert.match(example, new RegExp(`^${name}=$`, "m"), `${name} must be listed, empty`);
    }
  });

  test(".gitignore keeps the local env file out of the repository", () => {
    const ignore = read(".gitignore");
    assert.match(ignore, /^\.env\.local$/m);
    assert.match(ignore, /^\.env\*\.local$/m);
  });
});
