# Saiflow v1.0 — Release Candidate

**Branch:** `CP-prelaunch-honesty` · **State:** pre-launch (checkout gated) · **Market:** Saudi-first, Arabic-first

Saiflow is a marketplace for digital products in the Arabic language: sellers open a shop, upload digital products, and share a permanent public link; buyers land, purchase, and download. v1.0 ships the complete platform in honest pre-launch mode — everything works except moving money, which stays off until the payment provider is live.

---

## Features

- **Seller platform** — email/Google sign-in, shop creation (Arabic names fully supported), product upload (files to 512 MB via UploadThing), SAR pricing, sales dashboard.
- **Shareable storefronts** — permanent public URLs (`/shop/{slug}`, `/shop/{slug}/product/{productSlug}`) with canonical tags, per-page Open Graph/Twitter metadata (correct WhatsApp/LinkedIn/X previews), and a Share button (native sheet → clipboard → fallback).
- **Buyer flow** — browse with filters, product pages, purchase via hosted checkout (gated), instant download delivery bound to paid orders, purchase receipt email.
- **Arabic-first** — full AR/EN localization at key parity, server-rendered RTL, Arabic-Indic numerals, bilingual transactional surfaces.
- **SEO** — robots.txt, dynamic sitemap (live shops/products), structured metadata, branded social cards.

## Security

- Every API route audited; all rated Safe. Highlights: paid-order-gated downloads; owner-gated product API (closed a `fileUrl` leak); authenticated uploads; asset URLs allowlisted to the storage provider; login hardened (generic errors, IP throttling); signup/reset rate-limited; enumeration-safe password reset (single-use, 1h tokens); Stripe webhook signature-verified + idempotent; global security headers (DENY/nosniff/HSTS/referrer/permissions); PII scrubbed from logs; branded bilingual 404/500; patched Next.js 15.5.20 + next-intl (open-redirect fix).

## Moderation (Trust & Safety Tier 0)

- Mandatory seller certification at every upload (ownership, copyright/IP, KSA law, malware, prohibited content, legal responsibility) — server-enforced, timestamped.
- Every product starts **Pending Review**; only approved products appear anywhere public (home, browse, shop, product, checkout, sitemap).
- Admin review queue (`/dashboard/moderation`, `ADMIN_EMAILS`-gated); rejections require reasons.
- Append-only audit log: action, actor, reason, previous → new state, categories, confidence — AI-moderation-ready with **zero future schema changes** (Tier 1/2 blueprint in `docs/TRUST_AND_SAFETY.md`).
- Public **"Report this product"** on every product page (10 categories, rate-limited, audited, admin-notified, never auto-removes).

## Policies & Legal

- Terms (seller identity + KSA governing law), Privacy (PDPL-grounded; US processors + cross-border transfers disclosed), Refund Policy (digital-goods withdrawal exception), Content Policy (Saudi-first prohibited list), About (CR disclosure card), Contact — all bilingual where user-facing, all footer-linked.
- Honest positioning throughout: pre-launch banner, disabled checkout, no fabricated content, stats, or testimonials; brand voice is language-first ("Arabic-language creators"), not ethnicity-based.

## Launch blockers (all outside the codebase)

1. **Payment rail** — Moyasar merchant onboarding (needs CR + settlement bank) and checkout integration; Stripe remains dormant behind optional env vars.
2. **Legal placeholders** — real establishment name + CR number into Terms/About.
3. **Smoke test** — full checklist (docs/DEPLOYMENT.md §4) against a Vercel Preview with a live database.
4. **Support mailbox** — support@saiflow.io must receive mail (published legal/report contact).

## Known limitations (accepted for v1.0)

- Rate limiting is in-memory per serverless instance (Redis planned post-launch).
- Download links are the storage provider's URLs (signed/expiring links planned post-first-sale).
- Purchase email is English-only; blog/docs/whitepaper are English-only.
- Reset tokens stored unhashed (mitigated by 1h expiry + single use).
- 8 npm advisories in the `uploadthing → effect` chain (fix requires a breaking upgrade).
- US-East data residency (disclosed in Privacy Policy; ME-region migration post-revenue).
- Hero mentions mada/STC Pay/Apple Pay as planned rails while payments are gated (pre-launch banner discloses); align wording with actual rails at launch.
- Ratings schema exists but is unexposed; newsletter form is acknowledge-only.

## Roadmap (post-first-revenue)

1. Moyasar checkout + webhook (replaces the gate) → **first riyal**
2. Signed download URLs · Redis rate limiting · VAT-ready receipts
3. T&S Tier 1: malware scanning, seller moderation history (blueprint ready)
4. Multi-seller onboarding · payouts/fees ledger
5. T&S Tier 2: AI moderation + risk scoring · ratings · ME-region data
