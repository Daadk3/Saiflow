# Release Process

Every change to production follows this path. No exceptions for "tiny" changes — tiny changes with no process are how launches die.

## 1. Development
- Branch from the current release branch: `CP-<short-purpose>` (existing convention).
- Rules of the codebase: no PII in logs, all moderation state changes through the API (audit log), asset URLs validated, strings in `messages/*.json` for both locales, Prisma migrations additive whenever possible.
- Local gate before pushing: `SKIP_ENV_VALIDATION=1 npm run build` green + `npx tsc --noEmit` clean.

## 2. Preview
- Push → Vercel builds a Preview automatically (env vars from Preview scope; `PRE_LAUNCH_MODE=true` there always).
- Migrations run against the preview DB via the build command. Destructive migration? Neon branch first.

## 3. Smoke test
- Run the relevant slice of [`docs/DEPLOYMENT.md §4`](../DEPLOYMENT.md) on the Preview:
  - Auth or seller-flow changes → seller flow section.
  - Purchase-path changes → buyer flow section, **entirely**.
  - Copy/policy changes → the pages in both languages + footer links.
- Anything red: fix on the branch, push, re-test. Never "fix it in prod."

## 4. Production
- Gate: [`01_PRODUCTION_CHECKLIST.md`](01_PRODUCTION_CHECKLIST.md) top to bottom.
- Merge → promote to Production in Vercel.
- Deploy windows: mornings you're free (you are the on-call). Never before a day you can't check the site. Payment-touching changes: never on the eve of a weekend.

## 5. Post-release verification (10 minutes, same sitting)
- `api/health` 200 · homepage in AR and EN · one product page · `/dashboard/moderation` loads · Vercel logs clean for the first 15 minutes.
- Payment-path release (future): one real 1 SAR purchase + refund.

## 6. Rollback
- Trigger: any SEV1/SEV2 traceable to the release, or user-visible breakage without a ≤30-minute fix.
- Action: Vercel → promote previous good deployment (instant). Migrations are additive, so old code runs safely on the new schema.
- If the release included a destructive migration: restore the pre-deploy Neon branch **before** rolling code back — then treat as an incident ([`03_INCIDENT_RESPONSE.md`](03_INCIDENT_RESPONSE.md)).
- After any rollback: write the 10-minute post-mortem. The bug gets fixed on a branch, and takes the full path back through Preview. No shortcuts on the second attempt — that's when shortcuts bite.

## Versioning
- Release notes accumulate in `RELEASE_v<major>.<minor>.md` at the root (started with `RELEASE_v1.0.md`).
- A release that changes seller-visible behavior gets a line in the notes *before* it ships, not after.
