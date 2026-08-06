# Future Backlog

The single prioritized list. Items move between tiers **deliberately** (monthly review), not by enthusiasm. Rule inherited from the Board: nothing above P1 gets built before the first riyal unless it blocks the first riyal.

## P0 — Blocks the first riyal
| # | Item | Track |
|---|---|---|
| 1 | Moyasar merchant onboarding (CR activities 4791+6201 → bank → KYC) | Compliance |
| 2 | Moyasar checkout + webhook (replaces the pre-launch gate; reuse Order/idempotency pattern; provider-agnostic payment ref) | Revenue |
| 3 | Real CR number + establishment name into Terms/About | Compliance |
| 4 | Smoke test on Vercel Preview with live DB (`docs/DEPLOYMENT.md §4`) | Reliability |
| 5 | support@saiflow.io receiving mail | Compliance |
| 6 | Maroof registration | Compliance |

## P1 — First weeks of real money
| # | Item | Track |
|---|---|---|
| 1 | Signed, expiring download URLs (kills link-sharing; promoted immediately if abuse observed) | Security |
| 2 | Redis/Upstash rate limiting (replaces per-instance memory) | Security |
| 3 | Nightly `pg_dump` offsite + paid Neon PITR tier (real RPO) | Reliability |
| 4 | Uptime monitor on `/api/health` + Vercel log alerts | Reliability |
| 5 | VAT-ready receipts (groundwork for ZATCA at 375k SAR threshold) | Compliance |
| 6 | Hash reset tokens at rest | Security |
| 7 | Purchase email in Arabic (bilingual template) | Revenue |
| 8 | Error tracking (Sentry-class) replacing log-skimming | Reliability |

## P2 — Growth (after revenue is repeating)
| # | Item | Track |
|---|---|---|
| 1 | Multi-seller onboarding + payouts/fees ledger (split settlement via PSP — never hold funds) | Revenue |
| 2 | T&S Tier 1: malware scanning queue, seller moderation history, appeals UI (blueprint ready) | AI Moderation |
| 3 | Analytics: conversion funnel, traffic sources, top products (privacy-respecting) | Analytics |
| 4 | Ratings & reviews (schema already exists) | Revenue |
| 5 | Seller onboarding polish: guided first-product flow | Revenue |
| 6 | `uploadthing`/`effect` major upgrade (clears remaining npm advisories) | Security |
| 7 | ME/KSA-region database migration (PDPL posture) | Compliance |
| 8 | ISR for browse/product pages (requires locale-out-of-render refactor) | Performance |
| 9 | Enforced CSP (after Report-Only observation window) | Security |

## P3 — Someday, honestly
| # | Item | Track |
|---|---|---|
| 1 | T&S Tier 2: AI moderation pipeline + risk scoring (blueprint ready; triggers at >20 uploads/week) | AI Moderation |
| 2 | iOS app — **decision first: Apple takes 15–30% of digital goods via IAP; the web is commission-free. This is a pricing decision, not an engineering task** | Apple App |
| 3 | Enterprise/teams: multi-admin roles UI, SSO, invoicing | Enterprise |
| 4 | Subscriptions & memberships | Revenue |
| 5 | Seller storefront customization | Revenue |
| 6 | Public API for sellers | Enterprise |
| 7 | Newsletter backend (or remove the form) | Analytics |
| 8 | Automated test suite (starts paying for itself at multi-seller scale; write the first tests around checkout+webhook when Moyasar lands) | Reliability |

## Anti-backlog (decided: not doing)
- Holding seller funds ourselves (SAMA territory — always PSP split-settlement)
- A second marketplace vertical before this one earns
- Any feature that requires moderating content we can't legally assess
