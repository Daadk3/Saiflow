/**
 * The scan pipeline end to end for Illustrator and PostScript bytes
 * (lib/scan/run.ts), with the database, storage and provider replaced.
 *
 * Each case sets the stored bytes, the declared file name, the server switch
 * and the provider's answer, then asserts what was WRITTEN to the FileAsset
 * row and whether a provider call was spent. The only path to SAFE is the one
 * every PDF already takes; nothing here adds another.
 *
 * No PostScript is rendered or executed; the fixtures are header-shaped byte
 * strings. The provider is a local fake. Modelled on
 * tests/scan-structural-verdict-guard.test.ts.
 */

import { test, describe, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";

import type { ScanFindings, ScanProvider, ScanRequest } from "../lib/scan/provider";

const enc = new TextEncoder();
const ascii = (s: string) => enc.encode(s);
const cat = (...parts: (Uint8Array | number[])[]) => new Uint8Array(parts.flatMap((p) => [...p]));

const AI_PDF = ascii(
  "%PDF-1.6\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "3 0 obj\n<< /AIMetaData 4 0 R /AIPrivateData1 5 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
);
const AI_PDF_JS = ascii("%PDF-1.6\n1 0 obj\n<< /AIPrivateData1 5 0 R /OpenAction << /S /JavaScript /JS (x) >> >>\nendobj\n%%EOF\n");
const PLAIN_PDF = ascii("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const EPS = ascii("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\nshowpage\n");
const AI_LEGACY = ascii("%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator(R) 8.0\nshowpage\n");
const DOS_EPS = cat([0xc5, 0xd0, 0xd3, 0xc6], new Array<number>(26).fill(0), ascii("%!PS-Adobe-3.0\n"));
const EXE = cat(ascii("MZ"), new Array<number>(70).fill(0));

function makeZip(entries: { name: string; data: string }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const data = enc.encode(entry.data);
    const lh = new Uint8Array(30 + name.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint32(18, data.length, true);
    ldv.setUint32(22, data.length, true);
    ldv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, name.length, true);
    cdv.setUint32(42, offset, true);
    cd.set(name, 46);
    locals.push(lh, data);
    cds.push(cd);
    offset += lh.length + data.length;
  }
  const join = (parts: Uint8Array[]) => {
    const total = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const part of parts) {
      total.set(part, o);
      o += part.length;
    }
    return total;
  };
  const localPart = join(locals);
  const cdPart = join(cds);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, cdPart.length, true);
  edv.setUint32(16, localPart.length, true);
  return join([localPart, cdPart, eocd]);
}

const CLEAN: ScanFindings = {
  clean: true,
  verifiedFileFormat: ".pdf",
  containsExecutable: false,
  containsInvalidFile: false,
  containsScript: false,
  containsPasswordProtectedFile: false,
  containsRestrictedFileFormat: false,
  containsMacros: false,
  containsXmlExternalEntities: false,
  containsInsecureDeserialization: false,
  containsHtml: false,
  containsUnsafeArchive: false,
  containsOleEmbeddedObject: false,
  virusNames: [],
};

const state = {
  bytes: PLAIN_PDF as Uint8Array,
  name: "sample.pdf",
  providerCalled: false,
  lastRequest: null as ScanRequest | null,
  providerAnswer: (async () => ({ ok: true as const, findings: CLEAN })) as (r: ScanRequest) => Promise<
    { ok: true; findings: ScanFindings } | { ok: false; failure: "timeout" | "unconfigured" }
  >,
  written: null as Record<string, unknown> | null,
};

const originalSwitch = process.env.ILLUSTRATOR_PDF_UPLOADS;

function reset() {
  state.bytes = PLAIN_PDF;
  state.name = "sample.pdf";
  state.providerCalled = false;
  state.lastRequest = null;
  state.providerAnswer = async () => ({ ok: true, findings: CLEAN });
  state.written = null;
  delete process.env.ILLUSTRATOR_PDF_UPLOADS;
}

const fakeProvider: ScanProvider = {
  id: "fake",
  isConfigured: () => true,
  scan: async (request) => {
    state.providerCalled = true;
    state.lastRequest = request;
    return state.providerAnswer(request);
  },
};

let scanFileAsset: (
  key: string,
  opts?: { provider?: ScanProvider; now?: Date }
) => Promise<{ key: string; outcome: string; reason?: string }>;

before(async () => {
  const tx = {
    fileAsset: {
      updateMany: async (args: { data: Record<string, unknown> }) => {
        state.written = args.data;
        return { count: 1 };
      },
    },
    product: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    productDeliverable: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    moderationEvent: { createMany: async () => ({ count: 0 }) },
  };

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        fileAsset: {
          findUnique: async () => ({
            key: "k",
            shopId: "shop1",
            route: "PRODUCT_FILE",
            name: state.name,
            scanStatus: "PENDING_SCAN",
            scanAttempts: 0,
            scanAt: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
        product: { findFirst: async () => ({ id: "p1" }), fields: { fileKey: { _toFieldRef: "Product.fileKey" } } },
        $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
      },
    },
  });

  mock.module("@/lib/storage/provider", {
    namedExports: {
      MAX_SCANNABLE_BYTES: 128 * 1024 * 1024,
      readPrivateObject: async () => ({ ok: true, bytes: state.bytes }),
    },
  });

  scanFileAsset = (await import("../lib/scan/run.ts")).scanFileAsset as typeof scanFileAsset;
});

beforeEach(reset);
after(() => {
  if (originalSwitch === undefined) delete process.env.ILLUSTRATOR_PDF_UPLOADS;
  else process.env.ILLUSTRATOR_PDF_UPLOADS = originalSwitch;
});

const run = () => scanFileAsset("k", { provider: fakeProvider });

/* ------------------------------------------------------------------ */

describe("PostScript never reaches the provider and never becomes SAFE", () => {
  for (const [label, fixture, name] of [
    ["EPS", EPS, "art.eps"],
    ["DOS EPS", DOS_EPS, "art.eps"],
    ["legacy Illustrator", AI_LEGACY, "art.ai"],
    ["EPS renamed to .pdf", EPS, "art.pdf"],
  ] as const) {
    test(`${label}: UNSAFE postscript_unsupported, switch on or off`, async () => {
      for (const on of [false, true]) {
        reset();
        if (on) process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
        state.bytes = fixture;
        state.name = name;
        const report = await run();
        assert.equal(report.outcome, "UNSAFE", `${label} switch=${on}`);
        assert.equal(report.reason, "postscript_unsupported");
        assert.equal(state.written?.scanStatus, "UNSAFE");
        assert.equal(state.written?.scanReason, "postscript_unsupported");
        assert.equal(state.providerCalled, false, "no provider call is spent on PostScript");
      }
    });
  }
});

describe("a .ai-named PDF-compatible Illustrator file", () => {
  test("switch off (default): UNSAFE illustrator_disabled before the provider", async () => {
    state.bytes = AI_PDF;
    state.name = "pattern.ai";
    const report = await run();
    assert.equal(report.outcome, "UNSAFE");
    assert.equal(report.reason, "illustrator_disabled");
    assert.equal(state.written?.scanReason, "illustrator_disabled");
    assert.equal(state.providerCalled, false);
  });

  test("switch set to anything but 'on' is still off", async () => {
    for (const value of ["true", "1", "ON", "yes"]) {
      reset();
      process.env.ILLUSTRATOR_PDF_UPLOADS = value;
      state.bytes = AI_PDF;
      state.name = "pattern.ai";
      const report = await run();
      assert.equal(report.reason, "illustrator_disabled", value);
      assert.equal(state.providerCalled, false, value);
    }
  });

  test("switch on, provider verifies .pdf: SAFE through the ordinary PDF path", async () => {
    process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
    state.bytes = AI_PDF;
    state.name = "pattern.ai";
    const report = await run();
    assert.equal(report.outcome, "SAFE");
    assert.equal(state.written?.scanStatus, "SAFE");
    assert.equal(state.written?.scanReason, null);
    assert.equal(state.providerCalled, true);
    assert.deepEqual(state.lastRequest?.restrictToExtensions, [".pdf"], "the provider is asked for a PDF, not an AI");
    assert.equal(state.lastRequest?.allowHtml, false);
    assert.equal(state.lastRequest?.allowScripts, false);
    assert.equal(state.lastRequest?.fileName, "pattern.ai");
  });

  test("switch on, provider cannot verify the format: SCAN_ERROR format_not_verified, not sellable", async () => {
    process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
    state.bytes = AI_PDF;
    state.name = "pattern.ai";
    state.providerAnswer = async () => ({ ok: true, findings: { ...CLEAN, verifiedFileFormat: null } });
    const report = await run();
    assert.equal(report.outcome, "SCAN_ERROR");
    assert.equal(report.reason, "format_not_verified");
    assert.equal(state.written?.scanStatus, "SCAN_ERROR");
  });

  test("switch on, provider says .ai: UNSAFE format_mismatch", async () => {
    process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
    state.bytes = AI_PDF;
    state.name = "pattern.ai";
    state.providerAnswer = async () => ({ ok: true, findings: { ...CLEAN, verifiedFileFormat: ".ai" } });
    const report = await run();
    assert.equal(report.outcome, "UNSAFE");
    assert.equal(report.reason, "format_mismatch");
  });

  test("switch on, provider not clean with the restricted flag: UNSAFE format_mismatch", async () => {
    process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
    state.bytes = AI_PDF;
    state.name = "pattern.ai";
    state.providerAnswer = async () => ({
      ok: true,
      findings: { ...CLEAN, clean: false, containsRestrictedFileFormat: true, verifiedFileFormat: null },
    });
    const report = await run();
    assert.equal(report.outcome, "UNSAFE");
    assert.equal(report.reason, "format_mismatch");
  });

  test("switch on, the PDF token search still applies: JavaScript is UNSAFE before the provider", async () => {
    process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
    state.bytes = AI_PDF_JS;
    state.name = "pattern.ai";
    const report = await run();
    assert.equal(report.outcome, "UNSAFE");
    assert.ok(["pdf_javascript", "pdf_open_action"].includes(report.reason ?? ""), report.reason);
    assert.equal(state.providerCalled, false);
  });

  test("switch on, provider times out: SCAN_ERROR provider_timeout, retryable, never SAFE", async () => {
    process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
    state.bytes = AI_PDF;
    state.name = "pattern.ai";
    state.providerAnswer = async () => ({ ok: false, failure: "timeout" });
    const report = await run();
    assert.equal(report.outcome, "SCAN_ERROR");
    assert.equal(report.reason, "provider_timeout");
  });

  test("switch on, provider throws: SCAN_ERROR provider_threw", async () => {
    process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
    state.bytes = AI_PDF;
    state.name = "pattern.ai";
    state.providerAnswer = async () => {
      throw new Error("boom");
    };
    const report = await run();
    assert.equal(report.outcome, "SCAN_ERROR");
    assert.equal(report.reason, "provider_threw");
  });

  test("switch on, provider names malware: UNSAFE malware (threat checks come first)", async () => {
    process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
    state.bytes = AI_PDF;
    state.name = "pattern.ai";
    state.providerAnswer = async () => ({
      ok: true,
      findings: { ...CLEAN, clean: false, verifiedFileFormat: null, virusNames: ["EICAR-Test-File"] },
    });
    const report = await run();
    assert.equal(report.outcome, "UNSAFE");
    assert.equal(report.reason, "malware");
  });
});

describe("spoofed and renamed files", () => {
  test("an executable renamed to .ai: UNSAFE unrecognised_format, switch on or off", async () => {
    for (const on of [false, true]) {
      reset();
      if (on) process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
      state.bytes = EXE;
      state.name = "pattern.ai";
      const report = await run();
      assert.equal(report.outcome, "UNSAFE", `switch=${on}`);
      assert.equal(report.reason, "unrecognised_format");
      assert.equal(state.providerCalled, false);
    }
  });

  test("an Illustrator PDF saved as .pdf is an ordinary PDF: unaffected by the switch (regression)", async () => {
    for (const on of [false, true]) {
      reset();
      if (on) process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
      state.bytes = AI_PDF;
      state.name = "pattern.pdf";
      const report = await run();
      assert.equal(report.outcome, "SAFE", `switch=${on}`);
      assert.equal(state.providerCalled, true);
    }
  });

  test("a plain PDF named .ai with the switch off is refused too: the name alone can refuse", async () => {
    state.bytes = PLAIN_PDF;
    state.name = "pattern.ai";
    const report = await run();
    assert.equal(report.reason, "illustrator_disabled");
  });
});

describe("inside a ZIP", () => {
  for (const member of ["art.ai", "art.eps", "art.svg", "art.psd"]) {
    test(`${member} in a ZIP: UNSAFE archive_member_unsupported, no provider call, switch on or off`, async () => {
      for (const on of [false, true]) {
        reset();
        if (on) process.env.ILLUSTRATOR_PDF_UPLOADS = "on";
        state.bytes = makeZip([{ name: "README.md", data: "notes" }, { name: member, data: "%!PS synthetic" }]);
        state.name = "kit.zip";
        const report = await run();
        assert.equal(report.outcome, "UNSAFE", `${member} switch=${on}`);
        assert.equal(report.reason, "archive_member_unsupported");
        assert.equal(state.written?.scanReason, "archive_member_unsupported");
        assert.equal(state.providerCalled, false);
      }
    });
  }

  test("a ZIP of PDF and PNG still goes to the provider with the member list (regression)", async () => {
    state.bytes = makeZip([{ name: "pattern.pdf", data: "%PDF-1.4" }, { name: "preview.png", data: "png" }]);
    state.name = "kit.zip";
    state.providerAnswer = async () => ({ ok: true, findings: { ...CLEAN, verifiedFileFormat: ".zip" } });
    const report = await run();
    assert.equal(report.outcome, "SAFE");
    assert.equal(state.providerCalled, true);
    assert.ok(state.lastRequest?.restrictToExtensions.includes(".zip"));
    assert.ok(state.lastRequest?.restrictToExtensions.includes(".pdf"));
    assert.ok(!state.lastRequest?.restrictToExtensions.includes(".ai"));
  });
});
