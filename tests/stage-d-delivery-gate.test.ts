/**
 * Stage D1 — the delivery primitive and the gate-reason vocabulary.
 *
 * D1 adds two functions and wires them to nothing. Neither is called by any
 * route, so nothing here proves a gate works; that arrives with D2 onwards.
 * What IS proved:
 *
 *   - `deliverableGateReason` agrees with `isDeliverableSafe` on every
 *     reachable combination of the three columns, so the reason a gate reports
 *     can never contradict the decision the gate made.
 *   - `createDeliveryUrl` refuses malformed keys and out-of-range TTLs before
 *     it touches storage, and returns no URL on any failure path.
 *   - the scan path still cannot emit a signed URL.
 *
 * These run with no database, no network and no UploadThing credentials. That
 * is deliberate: every assertion below is about refusal, and a refusal that
 * needed a live provider to demonstrate would not be worth much.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { FileScanStatus } from "@prisma/client";

import {
  isDeliverableSafe,
  deliverableGateReason,
  type DeliverableSafety,
  type DeliverableGateReason,
} from "../lib/file-safety.ts";
import {
  createDeliveryUrl,
  DEFAULT_DELIVERY_TTL_SECONDS,
  MIN_DELIVERY_TTL_SECONDS,
  MAX_DELIVERY_TTL_SECONDS,
} from "../lib/storage/provider.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const providerSrc = read("../lib/storage/provider.ts");
const fileSafetySrc = read("../lib/file-safety.ts");

/** A key of the shape UploadThing actually issues, per extractAssetKey. */
const KEY_A = "abc123XY_key-one";
const KEY_B = "zzz999QQ_key-two";

const product = (
  fileKey: string | null,
  fileScanStatus: FileScanStatus,
  fileScanKey: string | null
): DeliverableSafety => ({ fileKey, fileScanStatus, fileScanKey });

/* ------------------------------------------------------------------ */
/* The seven required cases, stated one at a time                      */
/* ------------------------------------------------------------------ */

describe("deliverable safety: the individual cases", () => {
  test("1. SAFE with a matching non-null key is the only permission", () => {
    const p = product(KEY_A, "SAFE", KEY_A);
    assert.equal(isDeliverableSafe(p), true);
    assert.equal(deliverableGateReason(p), "safe");
  });

  test("2. a null fileKey refuses", () => {
    const p = product(null, "SAFE", KEY_A);
    assert.equal(isDeliverableSafe(p), false);
    assert.equal(deliverableGateReason(p), "missing_file_key");
  });

  test("3. PENDING_SCAN refuses", () => {
    const p = product(KEY_A, "PENDING_SCAN", null);
    assert.equal(isDeliverableSafe(p), false);
    assert.equal(deliverableGateReason(p), "pending_scan");
  });

  test("4. SCAN_ERROR refuses", () => {
    const p = product(KEY_A, "SCAN_ERROR", KEY_A);
    assert.equal(isDeliverableSafe(p), false);
    assert.equal(deliverableGateReason(p), "scan_error");
  });

  test("5. UNSAFE refuses", () => {
    const p = product(KEY_A, "UNSAFE", KEY_A);
    assert.equal(isDeliverableSafe(p), false);
    assert.equal(deliverableGateReason(p), "unsafe");
  });

  test("6. SAFE bound to a different key refuses", () => {
    // The file was replaced. The verdict is real, but it is a statement about
    // bytes this product no longer points at.
    const p = product(KEY_A, "SAFE", KEY_B);
    assert.equal(isDeliverableSafe(p), false);
    assert.equal(deliverableGateReason(p), "scan_key_mismatch");
  });

  test("7. fileKey null AND fileScanKey null refuses — null is not a match", () => {
    // The trap: `null === null` is true in JavaScript, so a fileless product
    // satisfies the key comparison on its own. Both functions must refuse.
    const p = product(null, "SAFE", null);
    assert.equal(p.fileScanKey === p.fileKey, true, "the trap is real");
    assert.equal(isDeliverableSafe(p), false);
    assert.equal(deliverableGateReason(p), "missing_file_key");
  });
});

/* ------------------------------------------------------------------ */
/* Equivalence, across every combination rather than the chosen ones    */
/* ------------------------------------------------------------------ */

describe("the reason can never contradict the decision", () => {
  const STATUSES: FileScanStatus[] = [
    "PENDING_SCAN",
    "SAFE",
    "UNSAFE",
    "SCAN_ERROR",
  ];
  const KEYS: (string | null)[] = [null, KEY_A, KEY_B];

  test("reason === 'safe' if and only if isDeliverableSafe is true", () => {
    let checked = 0;
    let permitted = 0;

    for (const fileKey of KEYS) {
      for (const status of STATUSES) {
        for (const scanKey of KEYS) {
          const p = product(fileKey, status, scanKey);
          const safe = isDeliverableSafe(p);
          const reason = deliverableGateReason(p);

          assert.equal(
            reason === "safe",
            safe,
            `disagreement at fileKey=${fileKey} status=${status} scanKey=${scanKey}: ` +
              `isDeliverableSafe=${safe} reason=${reason}`
          );

          checked++;
          if (safe) permitted++;
        }
      }
    }

    // Guards a vacuous pass: the matrix must be the full cross-product, and it
    // must contain both permissions and refusals.
    assert.equal(checked, 36, "every combination must be exercised");
    assert.ok(permitted > 0, "some combination must be permitted");
    assert.ok(permitted < checked, "some combination must be refused");
  });

  test("every reason returned is one of the declared categories", () => {
    const allowed: DeliverableGateReason[] = [
      "safe",
      "missing_file_key",
      "pending_scan",
      "scan_error",
      "unsafe",
      "scan_key_mismatch",
    ];
    const seen = new Set<string>();

    for (const fileKey of KEYS) {
      for (const status of STATUSES) {
        for (const scanKey of KEYS) {
          const reason = deliverableGateReason(product(fileKey, status, scanKey));
          assert.ok(allowed.includes(reason), `undeclared reason: ${reason}`);
          seen.add(reason);
        }
      }
    }

    // Every category must be reachable, or it is dead vocabulary that will
    // mislead whoever reads the telemetry later.
    for (const reason of allowed) {
      assert.ok(seen.has(reason), `unreachable category: ${reason}`);
    }
  });

  test("a permission requires all three columns to agree", () => {
    // Restating the predicate independently of its implementation: nothing
    // outside this exact shape may ever be permitted.
    for (const fileKey of KEYS) {
      for (const status of STATUSES) {
        for (const scanKey of KEYS) {
          const p = product(fileKey, status, scanKey);
          if (!isDeliverableSafe(p)) continue;
          assert.notEqual(p.fileKey, null);
          assert.equal(p.fileScanStatus, "SAFE");
          assert.equal(p.fileScanKey, p.fileKey);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* createDeliveryUrl: keys                                             */
/* ------------------------------------------------------------------ */

describe("createDeliveryUrl refuses malformed keys", () => {
  const badKeys: [string, unknown][] = [
    ["empty string", ""],
    ["whitespace", "   "],
    ["too short", "abc"],
    ["too long", "a".repeat(129)],
    ["path traversal", "../../etc/passwd"],
    ["slash", "f/abc123XY_key-one"],
    ["a full URL", "https://app.ufs.sh/f/abc123XY_key-one"],
    ["query string", "abc123XY_key-one?x=1"],
    ["dot segment", "abc123XY.key-one"],
    ["null byte", "abc123XY\0key-one"],
    ["newline", "abc123XY\nkey-one"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 12345678],
    ["an object", {}],
  ];

  for (const [label, key] of badKeys) {
    test(`${label} is rejected`, async () => {
      const result = await createDeliveryUrl(key as string);
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.reason, "invalid_key");
      assert.ok(!("url" in result), "a refusal must carry no URL");
    });
  }

  test("the boundary lengths behave as declared", async () => {
    // 7 characters is below the floor, 8 is the floor itself. Proves the
    // rejections above are a real bound rather than a blanket refusal.
    const belowFloor = await createDeliveryUrl("a".repeat(7));
    assert.equal(belowFloor.ok === false && belowFloor.reason, "invalid_key");

    const atFloor = await createDeliveryUrl("a".repeat(8));
    assert.equal(
      atFloor.ok === false && atFloor.reason,
      "storage_unconfigured",
      "a well-formed key must get past key validation"
    );

    const atCeiling = await createDeliveryUrl("a".repeat(128));
    assert.equal(atCeiling.ok === false && atCeiling.reason, "storage_unconfigured");
  });
});

/* ------------------------------------------------------------------ */
/* createDeliveryUrl: TTL bounds                                       */
/* ------------------------------------------------------------------ */

describe("createDeliveryUrl enforces TTL bounds", () => {
  test("the declared bounds are short, ordered and sane", () => {
    assert.ok(MIN_DELIVERY_TTL_SECONDS > 0);
    assert.ok(MIN_DELIVERY_TTL_SECONDS <= DEFAULT_DELIVERY_TTL_SECONDS);
    assert.ok(DEFAULT_DELIVERY_TTL_SECONDS <= MAX_DELIVERY_TTL_SECONDS);
    // A signed URL is a bearer credential. Five minutes is the ceiling this
    // codebase accepts; anything longer would need a deliberate decision.
    assert.ok(MAX_DELIVERY_TTL_SECONDS <= 300, "ceiling must stay short");
  });

  const badTtls: [string, number][] = [
    ["zero", 0],
    ["negative", -1],
    ["one second below the floor", MIN_DELIVERY_TTL_SECONDS - 1],
    ["one second above the ceiling", MAX_DELIVERY_TTL_SECONDS + 1],
    ["an hour", 3600],
    ["a day", 86_400],
    ["a week", 604_800],
    ["fractional", 60.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["beyond safe integers", Number.MAX_SAFE_INTEGER + 2],
  ];

  for (const [label, ttlSeconds] of badTtls) {
    test(`${label} is rejected, not clamped`, async () => {
      const result = await createDeliveryUrl(KEY_A, { ttlSeconds });
      assert.equal(result.ok, false);
      assert.equal(
        result.ok === false && result.reason,
        "invalid_ttl",
        `${label} must be refused outright — silently clamping would hide a caller bug`
      );
      assert.ok(!("url" in result), "a refusal must carry no URL");
    });
  }

  for (const [label, ttlSeconds] of [
    ["the floor", MIN_DELIVERY_TTL_SECONDS],
    ["the default", DEFAULT_DELIVERY_TTL_SECONDS],
    ["the ceiling", MAX_DELIVERY_TTL_SECONDS],
  ] as const) {
    test(`${label} passes TTL validation`, async () => {
      // Storage is unconfigured in tests, so getting as far as
      // storage_unconfigured is exactly the proof that the TTL was accepted.
      const result = await createDeliveryUrl(KEY_A, { ttlSeconds });
      assert.equal(result.ok === false && result.reason, "storage_unconfigured");
    });
  }

  test("an omitted TTL falls back to the default rather than to no limit", () => {
    assert.ok(
      /ttlSeconds = opts\.ttlSeconds \?\? DEFAULT_DELIVERY_TTL_SECONDS/.test(
        providerSrc
      ),
      "the default must be applied when the caller omits a TTL"
    );
    assert.ok(
      /expiresIn: ttlSeconds/.test(providerSrc),
      "the validated TTL must be the one handed to the signer"
    );
  });
});

/* ------------------------------------------------------------------ */
/* No signed URL escapes anywhere else                                 */
/* ------------------------------------------------------------------ */

describe("only createDeliveryUrl may return a URL", () => {
  test("the scan path's result type has no url member", () => {
    // Structural, not stylistic: readPrivateObject's success shape is bytes
    // and nothing else, so there is no field for a URL to travel in.
    const match = providerSrc.match(
      /export type StorageReadResult =([\s\S]*?);\n/
    );
    assert.ok(match, "StorageReadResult must be declared");
    const decl = match[1];
    assert.ok(decl.includes("bytes: Uint8Array"));
    assert.ok(!/\burl\b/i.test(decl), "the scan result must carry no URL");
  });

  test("the delivery failure shape has no url member either", () => {
    const match = providerSrc.match(/export type DeliveryUrlResult =([\s\S]*?);\n/);
    assert.ok(match, "DeliveryUrlResult must be declared");
    const decl = match[1];
    assert.ok(/ok: true; url: string/.test(decl), "success carries the URL");
    assert.ok(
      /ok: false; reason: DeliveryUrlFailure/.test(decl),
      "failure carries a reason only"
    );
  });

  test("the storage module logs nothing at all", () => {
    // The cheapest way to guarantee a signed URL is never logged is for the
    // module that holds one to contain no logging statement whatsoever.
    assert.ok(
      !/console\s*\./.test(providerSrc),
      "lib/storage/provider.ts must contain no console statement"
    );
  });

  test("the signing error is swallowed rather than propagated", () => {
    // An UploadThing error can echo the URL it was signing, so neither call
    // site may rethrow or attach the cause.
    assert.ok(
      !/catch\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{[^}]*(?:throw|cause)/.test(
        providerSrc
      ),
      "no catch block may rethrow or forward the cause"
    );
  });

  test("readPrivateObject is untouched by D1", () => {
    // Its contract is the load-bearing half of the invariant: bytes out, never
    // a link. These are the exact lines Stage C was reviewed against.
    assert.ok(providerSrc.includes("export async function readPrivateObject("));
    assert.ok(providerSrc.includes("signedUrl = signed.ufsUrl;"));
    assert.ok(providerSrc.includes("return { ok: true, bytes: buffer };"));
    assert.ok(providerSrc.includes('return { ok: false, reason: "sign_failed" };'));
  });

  test("no signed URL is persisted or handed to the database", () => {
    for (const forbidden of ["prisma", "@/lib/prisma"]) {
      assert.ok(
        !providerSrc.includes(forbidden),
        `the storage module must not reach the database (${forbidden})`
      );
    }
  });

  test("this test file prints nothing", () => {
    // A test that logged a URL would defeat the point of asserting that the
    // module does not.
    assert.ok(!/console\s*\./.test(read("./stage-d-delivery-gate.test.ts")));
  });
});

/* ------------------------------------------------------------------ */
/* The predicate keeps its authority                                    */
/* ------------------------------------------------------------------ */

describe("D1 is additive", () => {
  test("isDeliverableSafe still decides the boolean question itself", () => {
    // Not expressed in terms of deliverableGateReason: the reviewed predicate
    // is unchanged, which is why the equivalence matrix above exists.
    const match = fileSafetySrc.match(
      /export function isDeliverableSafe\([\s\S]*?\n\}/
    );
    assert.ok(match, "isDeliverableSafe must be declared");
    const body = match[0];
    assert.ok(body.includes("product.fileKey !== null"));
    assert.ok(body.includes('product.fileScanStatus === "SAFE"'));
    assert.ok(body.includes("product.fileScanKey === product.fileKey"));
    assert.ok(
      !body.includes("deliverableGateReason"),
      "the predicate must not delegate to the reason function"
    );
  });

  test("the database-level predicate is unchanged", () => {
    assert.ok(fileSafetySrc.includes("export const SAFE_DELIVERABLE_WHERE"));
    assert.ok(fileSafetySrc.includes('fileScanStatus: "SAFE"'));
    assert.ok(fileSafetySrc.includes("fileKey: { not: null }"));
    assert.ok(
      fileSafetySrc.includes("fileScanKey: { equals: prisma.product.fields.fileKey }")
    );
  });
});
