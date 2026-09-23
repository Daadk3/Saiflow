# File formats: accepted, recognised, proven

Three different lists exist, and only the last one may be shown to sellers or
buyers as "supported". The code behind each is `lib/scan/format-support.ts`,
pinned by `tests/scan-format-support.test.ts`.

| Format | Uploader accepts (declared type) | Scanner recognises (bytes) | Proven end-to-end on Preview |
|---|---|---|---|
| PDF | yes, 32MB | yes | **yes** — 22 Sep 2026, bought through Geidea test checkout and downloaded |
| EPUB | yes, 32MB | yes (ZIP container with OCF layout) | not yet |
| ZIP | yes, 128MB | yes | not yet |
| JPG, PNG | yes, 32MB | yes | not yet |
| GIF, WebP, AVIF, HEIC/HEIF | yes, 32MB | yes | not yet |
| MP3, WAV, M4A, FLAC, OGG | yes, via `audio/*`, 128MB | yes | not yet |
| MP4, MOV, WebM, MKV | yes, via `video/*`, 128MB | yes | not yet |
| any other `audio/*` or `video/*` (AVI, AIFF, AAC, WMV…) | yes | **no** — settled UNSAFE as `unrecognised_format` | no |

"Proven" means a real file of that format completed the whole path on Preview:
upload, scan to SAFE, moderation approval, checkout and download. A format
moves to that column only by such a run, recorded in `PROVEN_ON_PREVIEW`.

Recognised-but-unproven formats can still fail at the provider's
content-verification step (`format_not_verified`), which the seller now sees
as "unsupported format" with a retry. PNG, JPG, EPUB and ZIP are next in line
to be tested before they are listed publicly.
