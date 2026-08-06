# Backup & Recovery

## What the data is, and where

| Data | Lives in | Backed up by | Honest gap |
|---|---|---|---|
| Users, shops, products, orders, moderation audit | Neon Postgres | Neon point-in-time restore (history window depends on plan — **verify yours in the Neon console**; free tier is short) | History window; no offsite copy |
| Product files, thumbnails, logos | UploadThing | **Nothing.** UploadThing is hosting, not backup | Deleted = gone |
| Code, config, migrations | GitHub | Git itself | — |
| Env vars / secrets | Vercel | Not exported anywhere | Keep a sealed offline copy (password manager) |

## Targets (set deliberately, revisit at revenue)

- **RTO (max acceptable downtime): 4 hours** for the site; 24h for full function. Pre-revenue, honesty beats heroics.
- **RPO (max acceptable data loss): 24 hours** of DB writes; **zero** for product files (mitigation below).

## Standing rules

1. **Sellers keep their originals.** The seller certification flow implies it; make it explicit in seller comms. For seller #1 (you): keep every product file in your own storage (iCloud/Drive) — UploadThing is delivery, not archive.
2. **Monthly restore drill** (see [`02_DAILY_OPERATIONS.md`](02_DAILY_OPERATIONS.md)): create a Neon branch at a past timestamp, confirm rows exist, delete the branch. A backup you've never restored is a rumor.
3. **Before any destructive migration:** Neon branch/snapshot first. The current migration set is additive — keep it that way when possible.
4. **Post-revenue upgrade (backlog P1):** nightly `pg_dump` to object storage (offsite copy) + paid Neon tier for longer PITR history.

## Recovery priority (in order)

1. **Orders table** — proof of who paid. Money and law live here.
2. **Users + shops + products** — the platform itself.
3. **ModerationEvent audit log** — compliance evidence.
4. **Product files** — re-request from sellers if lost (they keep originals).
5. Cosmetics (thumbnails, logos) — regenerate/re-upload last.

## Disaster recovery plan (total loss scenario)

Scenario: Neon project gone, or corrupted beyond PITR window.

1. Stop the bleeding: promote a deploy with `PRE_LAUNCH_MODE=true` (no new money enters a broken system).
2. Create a fresh Postgres (Neon or elsewhere) → point `DATABASE_URL` at it → deploy runs `prisma migrate deploy` → clean schema.
3. Restore newest available data: Neon PITR branch → if none, latest `pg_dump` (once P1 backlog ships) → worst case: reconstruct orders from the payment provider's dashboard (Moyasar/Stripe hold the money truth) and ask sellers to re-upload.
4. Verify with the smoke test (`docs/DEPLOYMENT.md §4`) before reopening.
5. If any personal data was exposed rather than merely lost → breach playbook in [`03_INCIDENT_RESPONSE.md`](03_INCIDENT_RESPONSE.md).

**The uncomfortable truth to keep visible:** until the offsite dump ships, the real RPO for a worst-case Neon failure is the PITR window, and file recovery depends on sellers' own copies. Both are acceptable for pre-revenue; neither is acceptable after real sales volume. That's why they're P1, not P3.
