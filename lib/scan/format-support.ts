import { PRODUCT_FILE_CONFIG } from "@/lib/upload-config";
import type { SniffedFormat } from "./sniff";

/**
 * The three lists that must never be confused when SaiFlow says a format is
 * "supported". They are documented in docs/FILE_FORMATS.md and pinned by
 * tests/scan-format-support.test.ts.
 *
 *   UPLOADER_ACCEPTED   what the upload route lets through, by declared type
 *   SNIFFER_FAMILIES    what the scanner can establish from the bytes
 *   PROVEN_ON_PREVIEW   what has completed the whole path on Preview: upload,
 *                       scan to SAFE, moderation, checkout and download
 *
 * Only the third list may back a public claim. Add to it only after a real
 * file of that format has passed end-to-end on Preview, and never by editing
 * this file alone: the proof is the Preview run, this is its record.
 */
export const UPLOADER_ACCEPTED = Object.keys(PRODUCT_FILE_CONFIG) as readonly string[];

export const SNIFFER_FAMILIES: readonly Exclude<SniffedFormat, "unknown">[] = [
  "pdf",
  "zip",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "heic",
  "audio",
  "video",
];

/** Human-facing format names, keyed by what proves them. */
export type ProvenFormat = "pdf";

/** Proven on Preview on 22 September 2026: a PDF bought through Geidea test checkout and downloaded. */
export const PROVEN_ON_PREVIEW: readonly ProvenFormat[] = ["pdf"];

/** The only list marketing, onboarding and help copy may draw from. */
export const PUBLICLY_SUPPORTED: readonly ProvenFormat[] = PROVEN_ON_PREVIEW;
