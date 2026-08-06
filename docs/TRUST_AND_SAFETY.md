# Saiflow — Trust & Safety Architecture

**Status:** Tier 0 implemented · Tier 1/2 are blueprints, not code.
**Rule:** Tier 1 begins only when the first external (non-founder) seller is onboarded. Tier 2 begins only when manual review stops scaling.

---

## Tier 0 — Launch kernel (IMPLEMENTED)

What exists in code today:

| Piece | Where |
|---|---|
| Seller certification (mandatory, per-upload) | `add-product` form checkbox → enforced in `POST /api/products` → `Product.certifiedAt` |
| Prohibited Content Policy (AR/EN, Saudi-first) | `/content-policy`, linked at certification + footer |
| Pending-review default | `Product.moderationStatus = PENDING` on create; public queries filter `APPROVED` only (home, browse, shop, product, checkout, sitemap) |
| Audit log | `ModerationEvent` — append-only: action, actor, reason, categories, confidence, timestamp |
| Review queue | `/dashboard/moderation` (admin-gated via `ADMIN_EMAILS`) — approve / reject-with-reason |
| Backfill rule | Products created before moderation existed were auto-`APPROVED` in the migration |

**Design invariant:** the schema is already AI-ready. `ModerationEvent.actor` distinguishes `seller:<id>` / `admin:<id>` / `ai:<model>`; `categories[]` and `confidence` are populated only by AI. **Tiers 1–2 require no database changes.**

---

## Tier 1 — First external sellers (BLUEPRINT)

Trigger: a seller who is not the founder can upload.

1. **Malware scanning before publication.**
   - Architecture: on `SUBMITTED`, enqueue the `fileUrl` for scanning *before* the product is eligible for review. Options, in order of preference:
     a. **External scan API** (e.g. Cloudmersive/OPSWAT/VirusTotal-class) called from a queued job — no infra to run, per-file cost.
     b. **ClamAV worker** on a small VM/container consuming a queue — cheaper at volume, more ops.
   - Vercel constraint: scanning cannot run in the serverless request path (30s cap, no daemons). Use a queue (Upstash QStash / Vercel Queues) + callback that writes a `ModerationEvent` (`actor: "scanner:<engine>"`, categories: `["malware"]` on detection) and auto-`REJECTED` on positive detection.
   - Never serve a file publicly that has not passed a scan.

2. **Seller-facing moderation history.** Dashboard section listing each product's events (from `ModerationEvent`) with rejection reasons. Appeal = reply channel to support email; each appeal outcome recorded as a new event (`RESUBMITTED` → review again).

3. **Rate + size limits per seller.** Uploads/day cap and total-storage cap per seller (config, not schema).

4. **Seller suspension.** `Shop.isActive = false` already hides everything; add a `ModerationEvent` on a sentinel product or extend actor convention (`admin:<id>` action `REJECTED`, reason `seller-suspension:<why>`) — still no schema change; a dedicated `SellerSanction` table is optional if appeals volume grows.

## Tier 2 — AI moderation pipeline (BLUEPRINT)

Trigger: manual review exceeds ~15 min/day or >20 uploads/week.

1. **Pipeline** (queued job per `SUBMITTED` product):
   - Extract: title, description, tags/category (direct); PDF/DOCX/EPUB text (parser lib); ZIP listing + contained-file names (never execute contents); image thumbnails.
   - Single structured LLM call (Claude-class model) with the Content Policy as rubric →
     `{ decision: APPROVE | MANUAL_REVIEW | REJECT, categories: [...], confidence: 0–1, reasoning: string }`.
   - Write as `ModerationEvent` — `actor: "ai:<model-id>"`, `reason` = model reasoning, `categories`, `confidence`.
2. **Human-in-the-loop thresholds:** AI `APPROVE` with confidence ≥ 0.9 → auto-approve; `REJECT` with confidence ≥ 0.9 → auto-reject with seller notification; everything else → `MANUAL_REVIEW` queue (the Tier 0 console, upgraded with AI reasoning displayed).
3. **Risk scoring:** derived, never stored (computed from `ModerationEvent` history):
   - *Upload risk* = f(AI categories/confidence, file type, seller history).
   - *Seller risk* = f(rejection rate, appeal outcomes, account age, chargeback rate from Orders).
   - Surfaces in the admin console for queue ordering — high risk reviewed first.
4. **Explainability rule (constitutional):** every automated decision must carry its model id, reasoning, and confidence in the audit log. No decision without a stored explanation. Saudi regulator- and PSP-auditable by construction.

## Cost gates (decide before building)

| Item | Order of magnitude |
|---|---|
| Scan API | ~$0.001–0.01 per file |
| LLM moderation call | ~$0.01–0.05 per product |
| Queue (QStash-class) | free tier → ~$1/10k msgs |
| ClamAV VM (alt.) | ~$5–10/mo flat |

All post-revenue costs. None exist in Tier 0.
