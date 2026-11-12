/**
 * A refused admin inspection must be explainable without opening the file.
 *
 * The JSON body `{"error":"unsafe","scan":"unsafe"}` is the API refusal, and
 * it stays the API refusal. A browser navigation is sent to the review page.
 * The stored scan reason is reduced to a fixed key before anyone reads it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { explainScanReason, SCAN_EXPLANATION_KEYS } from "../lib/scan-explanation.ts";
import {
  inspectRefusalLocation,
  isInspectDocumentNavigation,
  isInspectionRefusalHint,
} from "../lib/inspect-document.ts";
import { inspectProduct } from "../lib/inspect.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("a stored scan reason becomes a fixed key or nothing", () => {
  test("known categories map, and the raw token is not returned when it is not the key", () => {
    assert.equal(explainScanReason("malware"), "malware");
    assert.equal(explainScanReason("pdf_javascript"), "pdf_javascript");
    assert.equal(explainScanReason("pdf_open_action"), "pdf_open_action");
    assert.equal(explainScanReason("pdf_submit_form"), "pdf_submit_form");
    assert.equal(explainScanReason("pdf_xfa"), "pdf_xfa");
    assert.equal(explainScanReason("archive_encrypted"), "password_protected");
    assert.equal(explainScanReason("unsafe_archive"), "archive");
    assert.equal(explainScanReason("html_content"), "html");
    assert.equal(explainScanReason("format_mismatch_terminal"), "format");
    assert.equal(explainScanReason("not_clean_unattributed"), "unattributed");
  });

  test("anything this build does not recognise is dropped, not echoed", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "Malware",
      "malware\n",
      "malware <script>alert(1)</script>",
      "constructor",
      "__proto__",
      "toString",
      "provider_timeout",
      "provider_bad_response_http_401_terminal",
      "file key utfs.io/f/secret",
      "a".repeat(65),
    ]) {
      assert.equal(explainScanReason(raw), null, JSON.stringify(raw));
    }
  });

  test("every explanation key has a sentence in both languages, and Arabic is Arabic", () => {
    const en = JSON.parse(read("../messages/en.json")).admin.fileSafety;
    const ar = JSON.parse(read("../messages/ar.json")).admin.fileSafety;
    assert.deepEqual(Object.keys(en.blockedBecause).sort(), [...SCAN_EXPLANATION_KEYS].sort());
    assert.deepEqual(Object.keys(ar.blockedBecause).sort(), [...SCAN_EXPLANATION_KEYS].sort());
    for (const key of SCAN_EXPLANATION_KEYS) {
      assert.equal(typeof en.blockedBecause[key], "string");
      assert.ok(en.blockedBecause[key].length > 20, key);
      assert.ok(/[؀-ۿ]/.test(ar.blockedBecause[key]), key);
      assert.ok(!en.blockedBecause[key].includes("scanReason"), key);
    }
    for (const key of ["notOpenable", "noFile", "blockedGeneric", "inspectionRefused"]) {
      assert.equal(typeof en[key], "string", key);
      assert.ok(/[؀-ۿ]/.test(ar[key]), key);
    }
  });
});

describe("only a browser navigation leaves the JSON refusal", () => {
  const nav = (headers: Record<string, string>) =>
    isInspectDocumentNavigation(new Request("https://saiflow.test/api/admin/inspect/prod_1", { headers }));

  test("a click or an address-bar visit is a document", () => {
    assert.equal(nav({ "sec-fetch-dest": "document", accept: "*/*" }), true);
    assert.equal(
      nav({ accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }),
      true
    );
  });

  test("fetch and an explicit JSON preference stay on the API body", () => {
    assert.equal(nav({}), false);
    assert.equal(nav({ accept: "*/*", "sec-fetch-dest": "empty" }), false);
    assert.equal(nav({ accept: "application/json" }), false);
    assert.equal(nav({ accept: "application/json, text/html;q=0.8" }), false);
    assert.equal(nav({ accept: "text/html, application/json" }), false);
  });
});

describe("the review redirect cannot be aimed", () => {
  test("a normal id and a refusal code produce one relative review URL", () => {
    assert.equal(
      inspectRefusalLocation("cmw3c125c0008jq08pve5zsar", "unsafe"),
      "/dashboard/admin/products/cmw3c125c0008jq08pve5zsar/preview?inspection=unsafe#file-safety"
    );
  });

  test("a crafted id or code produces no location", () => {
    for (const id of [
      "../evil",
      "prod/1",
      "prod_1?inspection=safe",
      "https://evil.test",
      "prod_1#file",
      "",
      "a".repeat(65),
      "prod 1",
    ]) {
      assert.equal(inspectRefusalLocation(id, "unsafe"), null, id);
    }
    for (const code of ["safe", "allow", "unsafe&next=/", "UNSAFE", ""]) {
      assert.equal(inspectRefusalLocation("prod_1", code), null, code);
    }
  });

  test("the review page treats only those codes as a hint", () => {
    assert.equal(isInspectionRefusalHint("unsafe"), true);
    assert.equal(isInspectionRefusalHint("no_file"), true);
    assert.equal(isInspectionRefusalHint(["unsafe"]), false);
    assert.equal(isInspectionRefusalHint("safe"), false);
    assert.equal(isInspectionRefusalHint("unsafe<script>"), false);
  });
});

describe("the refusal redirect does not widen what an admin may open", () => {
  test("UNSAFE stays refused for an admin", () => {
    const { decision } = inspectProduct(
      { fileKey: "k", fileScanStatus: "UNSAFE", fileScanKey: "k" },
      "admin"
    );
    assert.equal(decision.allow, false);
    if (decision.allow) return;
    assert.equal(decision.code, "unsafe");
    assert.equal(decision.status, 403);
    assert.ok(inspectRefusalLocation("prod_1", decision.code)?.includes("inspection=unsafe"));
  });

  test("SAFE is still openable, and the redirect helper will not describe it as a refusal", () => {
    const { decision } = inspectProduct(
      { fileKey: "k", fileScanStatus: "SAFE", fileScanKey: "k" },
      "admin"
    );
    assert.equal(decision.allow, true);
    assert.equal(inspectRefusalLocation("prod_1", "safe"), null);
  });
});
