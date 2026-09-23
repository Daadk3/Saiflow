/**
 * Which formats are accepted, recognised and proven — three lists that must
 * never be confused. docs/FILE_FORMATS.md is the human copy of this file.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PROVEN_ON_PREVIEW,
  PUBLICLY_SUPPORTED,
  SNIFFER_FAMILIES,
  UPLOADER_ACCEPTED,
} from "../lib/scan/format-support.ts";
import { sniffFormat } from "../lib/scan/sniff.ts";
import { PRODUCT_FILE_CONFIG } from "../lib/upload-config.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ascii = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (Uint8Array | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => [...p]));
const zeros = (n: number) => new Array<number>(n).fill(0);

describe("the uploader's list is unchanged in Phase 1", () => {
  test("it accepts exactly the current declared types", () => {
    assert.deepEqual(
      [...UPLOADER_ACCEPTED].sort(),
      ["application/epub+zip", "application/zip", "audio", "image/avif", "image/gif", "image/heic", "image/heif", "image/jpeg", "image/png", "image/webp", "pdf", "video"].sort()
    );
    assert.deepEqual(Object.keys(PRODUCT_FILE_CONFIG).sort(), [...UPLOADER_ACCEPTED].sort());
  });
});

describe("the sniffer recognises exactly the documented families", () => {
  test("each family is reachable from real leading bytes", () => {
    assert.equal(sniffFormat(bytes(ascii("%PDF-1.7 "), zeros(16))), "pdf");
    assert.equal(sniffFormat(bytes([0x50, 0x4b, 0x03, 0x04], zeros(12))), "zip");
    assert.equal(sniffFormat(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], zeros(8))), "png");
    assert.equal(sniffFormat(bytes([0xff, 0xd8, 0xff, 0xe0], zeros(12))), "jpeg");
    assert.equal(sniffFormat(bytes(ascii("ID3"), zeros(16))), "audio");
    assert.equal(sniffFormat(bytes(ascii("RIFF"), zeros(4), ascii("WAVE"), zeros(4))), "audio");
    assert.equal(sniffFormat(bytes([0, 0, 0, 0x18], ascii("ftypisom"), zeros(4))), "video");
    for (const f of ["pdf", "zip", "png", "jpeg", "audio", "video"]) {
      assert.ok((SNIFFER_FAMILIES as readonly string[]).includes(f), f);
    }
  });

  test("an AVI (RIFF without WAVE) is not recognised, so it can never become SAFE", () => {
    assert.equal(sniffFormat(bytes(ascii("RIFF"), zeros(4), ascii("AVI "), zeros(4))), "unknown");
  });
});

describe("only proven formats may be called supported", () => {
  test("PDF is the only proven format today", () => {
    assert.deepEqual([...PROVEN_ON_PREVIEW], ["pdf"]);
    assert.deepEqual([...PUBLICLY_SUPPORTED], [...PROVEN_ON_PREVIEW]);
  });

  test("every proven format is both accepted by the uploader and recognised by the sniffer", () => {
    for (const format of PROVEN_ON_PREVIEW) {
      assert.ok((UPLOADER_ACCEPTED as readonly string[]).includes(format), `${format} accepted`);
      assert.ok((SNIFFER_FAMILIES as readonly string[]).includes(format), `${format} recognised`);
    }
  });

  test("the documentation lists PDF as proven and nothing else", () => {
    const doc = read("../docs/FILE_FORMATS.md");
    const provenRows = doc.split("\n").filter((line) => /\*\*yes\*\*/.test(line));
    assert.equal(provenRows.length, 1);
    assert.ok(/^\| PDF/.test(provenRows[0]));
  });
});
