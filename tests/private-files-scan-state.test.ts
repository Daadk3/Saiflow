/**
 * Stage B — private deliverables and the scan-state foundation.
 *
 * What is proved here: the deliverable route is private, listing artwork is
 * not, storage keys are derived rather than trusted, and a replaced file
 * cannot inherit the previous file's verdict.
 *
 * What is NOT proved: that any file is safe. No scanner exists yet. Every
 * product in the database is PENDING_SCAN and stays that way until Stage C.
 *
 * Where a check reads source text it is because the behaviour lives in a route
 * handler that needs a database and a session to execute; those are marked.
 * Everything testable against real exported code is tested that way.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractAssetKey,
  extractOwnAssetKey,
  isAllowedAssetUrl,
  ownAssetHost,
} from "../lib/validations.ts";
import { isDeliverableSafe } from "../lib/file-safety.ts";
import {
  PRODUCT_FILE_CONFIG,
  PRODUCT_THUMBNAIL_CONFIG,
  SHOP_LOGO_CONFIG,
  SHOP_COVER_CONFIG,
} from "../lib/upload-config.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const core = read("../app/api/uploadthing/core.ts");
const createRoute = read("../app/api/products/route.ts");
const editRoute = read("../app/api/products/[id]/route.ts");
const schema = read("../prisma/schema.prisma");
const migration = read(
  "../prisma/migrations/20260811120000_add_file_scan_state/migration.sql"
);

type Entry = { maxFileSize: string; acl?: string; contentDisposition?: string };
const entries = (c: unknown) =>
  Object.entries(c as Record<string, Entry>);

/* ------------------------------------------------------------------ */
/* Private deliverables, public artwork                                */
/* ------------------------------------------------------------------ */

describe("the deliverable route is private", () => {
  test("every product-file type is acl private", () => {
    for (const [type, cfg] of entries(PRODUCT_FILE_CONFIG)) {
      assert.equal(cfg.acl, "private", `${type} must be private`);
    }
  });

  test("every product-file type downloads rather than renders", () => {
    // Defence in depth behind the private ACL: even via a signed URL, seller
    // content must not execute in the opener's tab.
    for (const [type, cfg] of entries(PRODUCT_FILE_CONFIG)) {
      assert.equal(cfg.contentDisposition, "attachment", `${type}`);
    }
  });

  test("the config is not empty (guards a vacuous pass above)", () => {
    assert.ok(entries(PRODUCT_FILE_CONFIG).length >= 12);
  });
});

describe("listing artwork stays public", () => {
  for (const [name, config] of [
    ["productThumbnail", PRODUCT_THUMBNAIL_CONFIG],
    ["shopLogo", SHOP_LOGO_CONFIG],
    ["shopCover", SHOP_COVER_CONFIG],
  ] as const) {
    test(`${name} declares no acl, so it keeps the public-read default`, () => {
      for (const [type, cfg] of entries(config)) {
        assert.equal(cfg.acl, undefined, `${name}.${type} must stay public`);
        assert.equal(cfg.contentDisposition, undefined, `${name}.${type}`);
      }
    });
  }
});

describe("PR #35 type hardening survives the ACL change", () => {
  test("no shorthand reappeared on any route", () => {
    for (const config of [
      PRODUCT_FILE_CONFIG,
      PRODUCT_THUMBNAIL_CONFIG,
      SHOP_LOGO_CONFIG,
      SHOP_COVER_CONFIG,
    ]) {
      for (const shorthand of ["image", "text", "blob"]) {
        assert.ok(!(shorthand in (config as object)), shorthand);
      }
    }
    assert.ok(!("application/x-rar-compressed" in PRODUCT_FILE_CONFIG));
  });

  test("ceilings are unchanged", () => {
    const c = PRODUCT_FILE_CONFIG as unknown as Record<string, Entry>;
    assert.equal(c["application/zip"].maxFileSize, "128MB");
    assert.equal(c.video.maxFileSize, "256MB");
    assert.equal(c.pdf.maxFileSize, "32MB");
  });
});

/* ------------------------------------------------------------------ */
/* File identity is derived, never trusted                             */
/* ------------------------------------------------------------------ */

describe("storage keys are derived from the URL", () => {
  test("a real storage URL yields its key", () => {
    assert.equal(
      extractAssetKey("https://z09wl7xuez.ufs.sh/f/DJpEnwlSWZmlKp5EZMs84Oxc"),
      "DJpEnwlSWZmlKp5EZMs84Oxc"
    );
    assert.equal(
      extractAssetKey("https://utfs.io/f/abcd1234EFGH"),
      "abcd1234EFGH"
    );
  });

  test("arbitrary external URLs yield no key", () => {
    for (const bad of [
      "https://evil.example.com/f/abcd1234EFGH", // arbitrary host
      "https://utfs.io.evil.com/f/abcd1234EFGH", // suffix spoof
      "http://utfs.io/f/abcd1234EFGH", // plaintext
      "javascript:alert(1)",
      "data:text/html,<script>",
      "https://169.254.169.254/f/abcd1234EFGH", // link-local, SSRF target
      "http://localhost:5432/f/abcd1234EFGH",
      "",
      null,
      undefined,
      12345,
    ]) {
      assert.equal(extractAssetKey(bad), null, `must reject ${String(bad)}`);
    }
  });

  test("an allowed host with a wrong path shape yields no key", () => {
    // Traversal, extra segments and query-smuggled paths must not resolve to
    // a key that disagrees with the stored URL.
    for (const bad of [
      "https://utfs.io/abcd1234EFGH", // no /f/
      "https://utfs.io/f/", // empty key
      "https://utfs.io/f/abcd1234EFGH/extra", // extra segment
      "https://utfs.io/f/../../etc/passwd",
      "https://utfs.io/x/abcd1234EFGH",
      "https://utfs.io/f/short", // implausibly short
    ]) {
      assert.equal(extractAssetKey(bad), null, `must reject ${bad}`);
    }
  });

  test("the key never disagrees with the URL it came from", () => {
    // The property that matters: a key is only ever a substring of its own
    // URL, so the two cannot describe different objects.
    const url = "https://z09wl7xuez.ufs.sh/f/DJpEnwlSWZmlKp5EZMs84Oxc";
    const key = extractAssetKey(url);
    assert.ok(key && url.endsWith(key));
  });

  test("extractAssetKey is strictly narrower than the host allowlist", () => {
    // A URL can pass the host check yet still not be a storage object.
    const hostOnly = "https://utfs.io/not-an-object";
    assert.equal(isAllowedAssetUrl(hostOnly), true);
    assert.equal(extractAssetKey(hostOnly), null);
  });
});

/* ------------------------------------------------------------------ */
/* Scan state                                                          */
/* ------------------------------------------------------------------ */

describe("scan state defaults closed", () => {
  test("the enum has exactly the four designed states", () => {
    const block = schema.slice(
      schema.indexOf("enum FileScanStatus"),
      schema.indexOf("}", schema.indexOf("enum FileScanStatus"))
    );
    for (const s of ["PENDING_SCAN", "SAFE", "UNSAFE", "SCAN_ERROR"]) {
      assert.ok(block.includes(s), `missing ${s}`);
    }
    for (const s of ["QUARANTINED", "RETRYING", "EXPIRED", "SUPERSEDED"]) {
      assert.ok(!block.includes(s), `unexpected extra state ${s}`);
    }
  });

  test("a new row is PENDING_SCAN and unbound", () => {
    assert.ok(
      /fileScanStatus\s+FileScanStatus\s+@default\(PENDING_SCAN\)/.test(schema)
    );
    assert.ok(/fileScanKey\s+String\?/.test(schema)); // no default => null
    assert.ok(/fileScanAttempts\s+Int\s+@default\(0\)/.test(schema));
  });

  test("the identity anchor and the verdict's key are separate columns", () => {
    // If these were one column the binding check would be a tautology.
    assert.ok(/fileKey\s+String\?/.test(schema));
    assert.ok(/fileScanKey\s+String\?/.test(schema));
  });

  test("nothing in the schema can mark a product SAFE by default", () => {
    assert.ok(!/@default\(SAFE\)/.test(schema));
  });
});

describe("the migration cannot fabricate a verdict", () => {
  test("it is additive only", () => {
    assert.ok(migration.includes("ADD COLUMN"));
    for (const forbidden of ["DROP COLUMN", "DROP TABLE", "DELETE FROM", "TRUNCATE"]) {
      assert.ok(!migration.includes(forbidden), `must not ${forbidden}`);
    }
  });

  test("it does not backfill or infer any scan result", () => {
    assert.ok(!/UPDATE\s+"Product"/i.test(migration), "must not write rows");
    assert.ok(!/INSERT\s+INTO/i.test(migration), "must not write rows");
    // "SAFE" legitimately appears as an enum member in CREATE TYPE and in the
    // file's comments. What must not exist is a statement that *assigns* it.
    const statements = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .replace(/CREATE TYPE[\s\S]*?;/, "");
    assert.ok(!statements.includes("SAFE"), "must never assign SAFE");
  });

  test("existing rows land on PENDING_SCAN", () => {
    assert.ok(migration.includes("DEFAULT 'PENDING_SCAN'"));
  });
});

/* ------------------------------------------------------------------ */
/* Write paths (source-level: these handlers need a DB and a session)  */
/* ------------------------------------------------------------------ */

describe("create binds the key it stores", () => {
  test("the key is derived from the URL, not read from the body", () => {
    // Strict extractor: derived AND pinned to our own app.
    assert.ok(createRoute.includes("extractOwnAssetKey(fileUrl)"));
    // fileKey must not be destructured from the request body.
    const body = createRoute.slice(0, createRoute.indexOf("await req.json()"));
    assert.ok(!/\bfileKey\b/.test(body), "fileKey must not come from the client");
  });

  test("an unresolvable file URL is rejected", () => {
    assert.ok(/if \(fileUrl && !fileKey\)/.test(createRoute));
    assert.ok(createRoute.includes('{ error: "Invalid file URL" }'));
  });

  test("the derived key is persisted and no verdict is set", () => {
    assert.ok(/fileKey,/.test(createRoute));
    assert.ok(!createRoute.includes("SAFE"), "create must never write a verdict");
  });
});

describe("edit closes the arbitrary-URL gap and invalidates stale verdicts", () => {
  test("fileUrl is validated on the edit path", () => {
    // The Stage A finding: this route previously wrote fileUrl straight
    // through, which the download redirect and the checkout HEAD both trust.
    // A changed value now goes through the strict, app-pinned extractor.
    assert.ok(editRoute.includes("extractOwnAssetKey(submittedFileUrl)"));
    assert.ok(editRoute.includes('{ error: "Invalid file URL" }'));
  });

  test("thumbnailUrl is validated too", () => {
    assert.ok(editRoute.includes("isAllowedAssetUrl(thumbnailUrl)"));
    assert.ok(editRoute.includes('{ error: "Invalid thumbnail URL" }'));
  });

  test("a changed key resets the whole scan record", () => {
    assert.ok(/nextFileKey !== undefined && nextFileKey !== product\.fileKey/.test(editRoute));
    const reset = editRoute.slice(editRoute.indexOf("fileChanged"));
    for (const field of [
      'fileScanStatus: "PENDING_SCAN"',
      "fileScanKey: null",
      "fileScanSha256: null",
      "fileScanAt: null",
      "fileScanAttempts: 0",
    ]) {
      assert.ok(reset.includes(field), `reset must clear ${field}`);
    }
  });

  test("edit never writes a verdict", () => {
    assert.ok(!/fileScanStatus: "SAFE"/.test(editRoute));
  });
});

/* ------------------------------------------------------------------ */
/* Upload authorisation                                                */
/* ------------------------------------------------------------------ */

describe("uploads require membership of the named shop", () => {
  test("all four routes take a shop id and run the membership check", () => {
    assert.equal((core.match(/\.input\(shopScopedUpload\)/g) ?? []).length, 4);
    assert.equal((core.match(/\.middleware\(requireShopMember\)/g) ?? []).length, 4);
  });

  test("the bare authenticated-user middleware is gone", () => {
    assert.ok(!core.includes("requireUser"), "any-signed-in-user check removed");
  });

  test("authorisation is a membership lookup, not a claim from the client", () => {
    assert.ok(core.includes("prisma.shopUser.findFirst"));
    assert.ok(/shopId: input\.shopId/.test(core));
    // Rejection must not depend on the client telling the truth.
    assert.ok(/if \(!membership\) \{[\s\S]*?UploadThingError\("Unauthorized"\)/.test(core));
  });

  test("failure modes are indistinguishable", () => {
    // No session, no shop and not-a-member must all look the same, so the
    // endpoint cannot be used to enumerate shop ids.
    const errors = core.match(/new UploadThingError\("[^"]+"\)/g) ?? [];
    assert.ok(errors.length >= 2);
    assert.ok(errors.every((e) => e === 'new UploadThingError("Unauthorized")'));
  });

  test("upload metadata carries no email", () => {
    const mw = core.slice(core.indexOf("const requireShopMember"), core.indexOf("ourFileRouter"));
    assert.ok(mw.includes("return { userId: membership.userId, shopId: input.shopId }"));
    assert.ok(!/return \{[^}]*email/.test(mw));
  });

  test("the upload callback logs identifiers, not the asset URL", () => {
    const complete = core.slice(core.indexOf("ourFileRouter"));
    assert.ok(!/console\.log\([^)]*file\.ufsUrl/.test(complete));
    assert.ok(complete.includes("file.key"));
  });
});

/* ------------------------------------------------------------------ */
/* Secrets and pre-launch                                              */
/* ------------------------------------------------------------------ */

describe("no secret reaches the client", () => {
  const clientFiles = [
    "../app/dashboard/shop/[slug]/add-product/page.tsx",
    "../app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
    "../app/dashboard/shop/[slug]/edit/page.tsx",
    "../lib/uploadthing.ts",
  ];

  test("no client module references an API key", () => {
    for (const f of clientFiles) {
      const src = read(f);
      assert.ok(!/_API_KEY|API_KEY|CLOUDMERSIVE/i.test(src), `${f} references a key`);
    }
  });

  test("no key is exposed through a NEXT_PUBLIC_ variable", () => {
    for (const f of [...clientFiles, "../lib/upload-config.ts", "../app/api/uploadthing/core.ts"]) {
      assert.ok(!/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/.test(read(f)), f);
    }
  });

  test("the scanner is genuinely not wired up yet", () => {
    // Stage B must not have started Stage C by accident.
    for (const f of ["../app/api/uploadthing/core.ts", "../lib/upload-config.ts"]) {
      assert.ok(!/cloudmersive/i.test(read(f)), `${f} must not call a scanner`);
    }
  });
});

describe("pre-launch and buyer access are untouched", () => {
  test("the checkout pre-launch gate is intact", () => {
    const checkout = read("../app/api/checkout/route.ts");
    assert.ok(checkout.includes("env.PRE_LAUNCH_MODE"));
    assert.ok(checkout.includes('error: "pre_launch"'));
  });

  test("download still requires proof of purchase", () => {
    const dl = read("../app/api/download/[productId]/route.ts");
    assert.ok(dl.includes("Not authorized to download this product"));
  });

  test("PRE_LAUNCH_MODE is still declared", () => {
    assert.ok(read("../lib/env.ts").includes("PRE_LAUNCH_MODE"));
  });
});

/* ------------------------------------------------------------------ */
/* Writes must land on OUR UploadThing app                             */
/* ------------------------------------------------------------------ */

describe("write-path host pinning", () => {
  // A fixed app id is passed explicitly so the test never depends on the
  // environment, and never reads a configured value.
  const APP = "z09wl7xuez";
  const OURS = `https://${APP}.ufs.sh/f/abcd1234EFGH`;

  test("the expected host is <appId>.ufs.sh", () => {
    assert.equal(ownAssetHost(APP), "z09wl7xuez.ufs.sh");
    assert.equal(ownAssetHost("  Z09WL7XUEZ  "), "z09wl7xuez.ufs.sh");
  });

  test("a file on our own app is accepted", () => {
    assert.equal(extractOwnAssetKey(OURS, APP), "abcd1234EFGH");
  });

  test("a foreign UploadThing tenant is REJECTED", () => {
    // The case this whole change exists for: a seller uploading to their own
    // personal UploadThing account, then pointing a product at it. The file
    // never passed our type or size allowlist.
    assert.equal(
      extractOwnAssetKey("https://attacker9xyz.ufs.sh/f/abcd1234EFGH", APP),
      null
    );
    assert.equal(
      extractOwnAssetKey("https://z09wl7xuez-evil.ufs.sh/f/abcd1234EFGH", APP),
      null
    );
    assert.equal(
      extractOwnAssetKey("https://sub.z09wl7xuez.ufs.sh/f/abcd1234EFGH", APP),
      null
    );
  });

  test("the shared utfs.io domain is REJECTED for writes", () => {
    // utfs.io is shared by every UploadThing tenant, so a URL there can never
    // demonstrate that the object is ours.
    assert.equal(extractOwnAssetKey("https://utfs.io/f/abcd1234EFGH", APP), null);
  });

  test("other allowlisted read hosts are rejected for writes", () => {
    assert.equal(
      extractOwnAssetKey("https://x.uploadthing.com/f/abcd1234EFGH", APP),
      null
    );
  });

  test("an unconfigured app id fails CLOSED", () => {
    // Never "allow anything" when the app id is missing.
    assert.equal(ownAssetHost(""), null);
    assert.equal(ownAssetHost(undefined), process.env.UPLOADTHING_APP_ID ? ownAssetHost() : null);
    assert.equal(extractOwnAssetKey(OURS, ""), null);
  });

  test("everything extractAssetKey rejects, extractOwnAssetKey rejects too", () => {
    for (const bad of [
      "https://evil.example.com/f/abcd1234EFGH",
      "https://utfs.io.evil.com/f/abcd1234EFGH",
      "http://z09wl7xuez.ufs.sh/f/abcd1234EFGH",
      `https://${APP}.ufs.sh/f/abcd1234EFGH/extra`,
      `https://${APP}.ufs.sh/f/short`,
      "javascript:alert(1)",
      null,
      undefined,
    ]) {
      assert.equal(extractOwnAssetKey(bad, APP), null, `must reject ${String(bad)}`);
    }
  });

  test("reads are unaffected — legacy hosts still resolve", () => {
    // admin-stats and thumbnails still use the permissive reader, so the
    // legacy utfs.io rows keep rendering and stay inspectable.
    assert.equal(extractAssetKey("https://utfs.io/f/abcd1234EFGH"), "abcd1234EFGH");
    assert.equal(isAllowedAssetUrl("https://utfs.io/f/abcd1234EFGH"), true);
  });
});

describe("write paths use the strict extractor", () => {
  test("create always pins to our app", () => {
    assert.ok(createRoute.includes("extractOwnAssetKey(fileUrl)"));
    assert.ok(
      !createRoute.includes("extractAssetKey(fileUrl)"),
      "create must not use the permissive reader"
    );
  });

  test("edit pins only when the value actually changes", () => {
    assert.ok(/const fileUrlChanged\s*=/.test(editRoute));
    assert.ok(editRoute.includes("extractOwnAssetKey(submittedFileUrl)"));
    // The unchanged branch must stay permissive, or legacy rows become
    // uneditable — the edit form echoes the stored URL back on every save.
    assert.ok(
      /if \(!fileUrlChanged\)[\s\S]*?extractAssetKey\(product\.fileUrl\)/.test(editRoute)
    );
  });

  test("edit still validates after ownership is proven", () => {
    assert.ok(
      editRoute.indexOf("You don't have permission to edit this product") <
        editRoute.indexOf("extractOwnAssetKey(submittedFileUrl)"),
      "URL validation must not run before the ownership check"
    );
  });
});

/* ------------------------------------------------------------------ */
/* The safety predicate                                                */
/* ------------------------------------------------------------------ */

describe("isDeliverableSafe", () => {
  const KEY = "abcd1234EFGH";

  test("the one true case", () => {
    assert.equal(
      isDeliverableSafe({
        fileKey: KEY,
        fileScanStatus: "SAFE",
        fileScanKey: KEY,
      }),
      true
    );
  });

  test("null fileKey with null fileScanKey is NOT safe", () => {
    // The footgun this function exists for: `null === null` is true, so a
    // fileless product would satisfy a naive key comparison.
    assert.equal(
      isDeliverableSafe({
        fileKey: null,
        fileScanStatus: "SAFE",
        fileScanKey: null,
      }),
      false
    );
  });

  test("a verdict for a different key is NOT safe", () => {
    // The replaced-file case: the verdict belongs to the previous upload.
    assert.equal(
      isDeliverableSafe({
        fileKey: "newKey9999AA",
        fileScanStatus: "SAFE",
        fileScanKey: KEY,
      }),
      false
    );
  });

  test("SAFE with no attached file is NOT safe", () => {
    assert.equal(
      isDeliverableSafe({ fileKey: null, fileScanStatus: "SAFE", fileScanKey: KEY }),
      false
    );
  });

  test("every non-SAFE status is not safe", () => {
    for (const status of ["PENDING_SCAN", "UNSAFE", "SCAN_ERROR"] as const) {
      assert.equal(
        isDeliverableSafe({ fileKey: KEY, fileScanStatus: status, fileScanKey: KEY }),
        false,
        `${status} must not be safe`
      );
    }
  });

  test("an unscanned product with a file is not safe", () => {
    assert.equal(
      isDeliverableSafe({
        fileKey: KEY,
        fileScanStatus: "PENDING_SCAN",
        fileScanKey: null,
      }),
      false
    );
  });
});
