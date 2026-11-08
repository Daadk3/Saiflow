# Limited Illustrator support: what is built, what is proven, what is not

Status on 8 November 2026: **code present, switch off, unverified against the
provider.** Nothing here may reach production or be mentioned publicly until
the acceptance plan below has passed and Daad has approved it separately.

## 1. What the code does

| Piece | Behaviour | Switch-dependent? |
|---|---|---|
| `lib/scan/sniff.ts` | `%!PS` and the DOS-EPS header sniff as `postscript`. `isIllustratorPdf` labels a PDF carrying `/AIPrivateData` or `/AIMetaData`. Labels only. | no |
| `lib/scan/policy.ts` | PostScript has no policy (never SAFE). `refusalReasonForBytes` names it `postscript_unsupported`. An ordinary ZIP with an AI/EPS/PS/SVG/PSD/INDD member is refused structurally as `archive_member_unsupported`, before a provider call. EPUB keeps SVG. | no |
| `lib/scan/illustrator.ts` | `illustratorUploadsEnabled()` is true only for the exact value `on`. `illustratorVerdict` refuses a `.ai`-NAMED file under the PDF policy while the switch is off (`illustrator_disabled`). With it on, the file continues through the unchanged PDF path: token search, provider with `restrictFileTypes=.pdf`, content-verified `.pdf` required. | yes |
| `lib/scan/run.ts` | Calls the two above. Same explicit-ALLOW discipline as the structural and provider verdicts. | yes |
| `lib/upload-config.ts`, `app/api/uploadthing/core.ts` | `PRODUCT_FILE_CONFIG_WITH_ILLUSTRATOR` adds `application/postscript` (32MB, private, attachment). The route uses it only while the switch is on, read at module load. The seller-facing labels keep using `PRODUCT_FILE_CONFIG`, so AI is never advertised. | yes |
| `lib/seller-file-state.ts`, `components/FileScanState.tsx`, `lib/scan-explanation.ts` | New reasons map to `unsupported_format` / `unsupported_member` for the seller and `format` / `unsupported_member` for the admin. Never to a threat. | no |
| `messages/*.json` | FAQ, help centre, add-product card, product-file field, uploader type refusal, seller failure sentences, admin explanation. Both languages. | no |

What is NOT changed: `RECOGNISED_FORMATS` (`.ai` and `.eps` are not in it, so
a provider that verified either would still be `format_mismatch`),
`ORDINARY_ZIP_MEMBER_EXTENSIONS`, provider flags, review gates, checkout gate,
download gate, delivery mechanism, `PUBLICLY_SUPPORTED`.

## 2. Why the switch defaults to off

The seller's upload is refused at two places today, and only the second is a
safety decision:

1. The upload route does not list `application/postscript`, the MIME type both
   `.ai` and `.eps` resolve to, so the client refuses the file before a byte is
   stored. This is attack-surface reduction, not scanning.
2. Had it been stored, a PDF-compatible `.ai` would sniff as `pdf` and take the
   PDF policy; the provider would be asked for `.pdf`.

Step 2 is the unverified part. Cloudmersive's knowledge-base article "Advanced
Scan API File Format Support" (read 8 Nov 2026, page header dated 28 Sep 2026)
lists `.eps` for content verification and does **not** list `.ai`. Whether a
PDF-compatible Illustrator file submitted under a `.ai` filename with
`restrictFileTypes=.pdf` comes back `VerifiedFileFormat: ".pdf"` is not
documented. If it comes back null, every such file settles `SCAN_ERROR
format_not_verified` and burns three provider calls for nothing. The switch
exists so that question is answered on Preview, with one real file, before any
seller is affected.

Verified from the official documentation (api.cloudmersive.com/docs/virus.asp,
cloudmersive.com/virus-api, the knowledge-base article above):

- `VerifiedFileFormat` is null when "the file format is not supported for
  contents verification" and always null when malware is found.
- `restrictFileTypes`: "All files must pass content verification against this
  list of file formats, if they do not, then the result will be returned as
  CleanResult=false."
- `allowScripts` names PHP, Python, BAT and JS. PostScript is not mentioned
  anywhere in the documentation read.
- Not documented: whether `restrictFileTypes` applies to archive members (the
  repository's own observed behaviour says it does), recursion depth, member
  content verification, the endpoint's size and timeout limits.

Not tested: no controlled provider call was made. No scanner key is available
in the local environment, and a call against the production key would spend
production quota, so it needs Daad's approval first (section 5).

## 3. Why EPS stays blocked

EPS is a PostScript program executed by whatever opens it (Illustrator,
Ghostscript and everything built on it, macOS Preview and Quick Look). The
pipeline can recognise the header; it cannot evaluate or render the program
safely, a byte-level denylist of dangerous operators is evadable because
PostScript builds and executes strings at run time, and the provider's
documentation says nothing about judging PostScript code. Legacy `.ai` files
are EPS. This is a position, not a gap to close later with a flag.

## 4. Private-preview acceptance plan (switch on, Preview only)

Run only on the Preview deployment with `ILLUSTRATOR_PDF_UPLOADS=on` set there
and nowhere else. Every step is observed, none is assumed. Stop at the first
failure and leave the switch off in production.

**Fixtures** (Daad or a designer supplies them; none are in the repository):
A. a modern `.ai` saved with "Create PDF Compatible File" on, with layers.
B. the same artwork saved with that option off (non-PDF `.ai`).
C. a real `.eps`.
D. a renamed file: a PNG or executable renamed `.ai`.
E. a ZIP containing A and a PNG preview.
F. the same artwork exported as `.pdf` with "Preserve Illustrator Editing Capabilities" (the recommended seller path).

**Upload.** A uploads on the product form; the button's allowed-types label does
not mention AI (expected: it lists PDF, EPUB, ZIP, audio, video, images). B, C
and D upload too (they share the MIME type). E uploads as a ZIP. Record the
`FileAsset.declaredType` for each.

**Scan.** Within the scan window: A settles `SAFE` with `scanReason` null; B and
C settle `UNSAFE postscript_unsupported`; D settles `UNSAFE unrecognised_format`;
E settles `UNSAFE archive_member_unsupported`; F settles `SAFE`. Exactly one
provider call for A and F, none for B–E (check the moderation event
`file-scan:` rows and the provider dashboard's call count). If A settles
`SCAN_ERROR format_not_verified`, the provider does not verify a `.ai`-named PDF
as `.pdf`: stop, switch off, and the format stays blocked (section 5, question 1).

**Seller view.** B and C show "File check failed" with the unsupported-format
sentence (the one that names AI/EPS and says it is not a report of harmful
content); E shows the unsupported-member sentence; none offers a retry; A and F
show "File checked".

**Review.** The admin preview for A opens the file through the inspection link
in a PDF viewer and in Illustrator; layers are present. The checklist facts
show `kind: pdf`. The admin explanation for E reads the unsupported-member
sentence.

**Checkout eligibility.** With A approved, the product is purchasable through
the Geidea test checkout. With B, C, D or E attached, the product cannot be
approved and checkout refuses it.

**Download.** The buyer's download of A returns `content-disposition:
attachment`, the original filename with its `.ai` extension, and bytes whose
SHA-256 equals `FileAsset.scanSha256`. The file opens in Illustrator with
layers. Record the response headers.

**Record.** Only after all of the above: add `"ai"` to `PROVEN_ON_PREVIEW`
in `lib/scan/format-support.ts` in a separate change, update
`docs/FILE_FORMATS.md`, and only then consider public copy. Turning the switch
on in production is a separate approval.

## 5. Unresolved questions

1. Does Cloudmersive return `VerifiedFileFormat: ".pdf"` for a PDF-compatible
   `.ai` submitted under a `.ai` filename with `restrictFileTypes=.pdf`? Answer
   by the Preview run above, or by a support question (draft below, not sent).
2. Does `restrictFileTypes` apply to archive members by design? The repository
   observed it does; the documentation does not say. Same support question.
3. Which MIME string do Chrome, Safari and Firefox on macOS and Windows send for
   `.ai`? Expected `application/postscript` or empty; `application/illustrator`
   would be refused even with the switch on and would need its own entry.
4. Should the seller-facing allowed-types label ever mention AI? Not while the
   format is unproven; revisit with the `PROVEN_ON_PREVIEW` change.
5. Should the switch also allow `.ai` members inside a ZIP? No, and not later:
   members are never byte-sniffed, so that would be trusting a filename.

Draft support question for Cloudmersive, for Daad's review before sending:

> We use the Advanced Virus Scan endpoint with `restrictFileTypes`. Two
> questions about content verification. (1) For a modern Adobe Illustrator
> `.ai` file that is PDF-compatible (the file begins with `%PDF-` and carries
> Illustrator's private data streams), submitted under a `.ai` filename with
> `restrictFileTypes=.pdf`, what does `VerifiedFileFormat` return, and does the
> file pass the restriction? (2) Is the `restrictFileTypes` whitelist applied to
> members of a ZIP archive as well as the top-level file, and are members
> content-verified? We are deciding whether to accept these files and would
> like to rely on documented behaviour rather than a single test.
