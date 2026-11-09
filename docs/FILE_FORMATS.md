# File formats: accepted, recognised, proven

Three different lists exist, and only the last one may be shown to sellers or
buyers as "supported". The code behind each is `lib/scan/format-support.ts`,
pinned by `tests/scan-format-support.test.ts`.

| Format | Uploader accepts (declared type) | Scanner recognises (bytes) | Proven end-to-end on Preview |
|---|---|---|---|
| PDF | yes, 32MB | yes | **yes** — 22 Sep 2026, bought through Geidea test checkout and downloaded |
| EPUB | yes, 32MB | yes (ZIP container with OCF layout) | not yet |
| ZIP | yes, 128MB | yes | not yet |
| Excel workbook (.xlsx, no macros) | yes, 32MB | yes, only when the ZIP is a non-macro OOXML workbook | not yet |
| Local HTML app (a ZIP with the exact `saiflow-local-html-app.json` marker; not a separate upload type) | yes, as `application/zip`, 128MB | yes, named archive policy `local_html_app` | not yet |
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

## Local HTML app archives

This is a named ZIP policy, not a new public format and not an EPUB.

The marker entry must be named exactly `saiflow-local-html-app.json`, sit at
the archive root, be stored uncompressed, and contain exactly:

```json
{"saiflowArchiveType":"local-html-app","version":1}
```

No BOM, newline, or extra fields. Members may be `.html`, `.htm`, `.css`,
`.json`, `.md`, `.txt`, and classic `.js` only. `.mjs`, `.cjs`, `.py`, `.sh`,
`.php`, executables, nested archives, traversal, symlinks, and remote or inline
script are rejected. Images are not part of this allowance. A ZIP without a
valid marker keeps the ordinary ZIP rules, including `allowHtml: false`.

SaiFlow does not host or execute the app. Delivery stays a private ZIP
attachment, behind the existing paid-order and admin-approval gates. The type
is not read from the product description. It is not listed in
`PUBLICLY_SUPPORTED` until a Preview run proves the whole path.

## Ordinary ZIP members

A ZIP without the local-HTML marker stays `kind: "zip"`. Structural policy
still rejects encryption, traversal, symlinks, nested archives, executables,
and scripts (including `.py` and `.js`). It does not allow HTML.

The provider request for that kind lists `.zip` plus the member types SaiFlow
already accepts inside it: `.pdf`, `.md`, `.txt`, `.csv`, `.xlsx`, and the same raster
image extensions as a standalone image. An `.xlsx` member is opened and checked
with the same workbook rules as a primary file. `.xlsm`, `.xls`, `.xlsb`, `.xltm`,
`.xlam` and the other macro-enabled Office names are rejected in the archive. Sending only `.zip` made Cloudmersive's
member whitelist report `ContainsRestrictedFileFormat`, which SaiFlow records
as `format_mismatch` — the admin sentence "The file format is not one SaiFlow
can sell, or it does not match its contents." Listing the member types is not
a waiver: that flag is still a rejection, and so are malware, scripts,
executables, and active PDF content. The container must still verify as
`.zip`. A local HTML app is not this list; its request stays `.zip` only, with
the existing reviewed waiver for its own members. ZIP is still not proven
end-to-end on Preview, so it is not in `PUBLICLY_SUPPORTED`.
