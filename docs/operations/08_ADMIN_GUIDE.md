# Admin Guide

Everything an administrator of Saiflow must know. Today the administrator is the founder; write access to this file is how you onboard admin #2 someday.

## Becoming / creating an admin
1. Admin = any email listed in the `ADMIN_EMAILS` env var (comma-separated) **and** registered as a normal user account with that email.
2. Add the email in Vercel → Settings → Environment Variables → redeploy. There is no in-app role UI by design (Tier 0).
3. Admin powers: `/dashboard/moderation` queue + approve/reject APIs. Nothing else is elevated — admins are normal users everywhere else.
4. Offboarding: remove from `ADMIN_EMAILS`, redeploy. Their past decisions remain attributed in the audit log (`admin:<userId>`).

## Environment & secrets
- Authoritative schema: `lib/env.ts` (validated at boot — bad config fails the deploy, not the user).
- Full table + purposes: [`docs/DEPLOYMENT.md §1`](../DEPLOYMENT.md).
- Secrets live in Vercel env + a sealed copy in your password manager. Never in git, chat, or screenshots.
- Rotation: quarterly, and immediately on any suspicion ([`05_SECURITY_RUNBOOK.md`](05_SECURITY_RUNBOOK.md)).

## Deployments & releases
- Process: [`09_RELEASE_PROCESS.md`](09_RELEASE_PROCESS.md). Never push straight to production; the Preview + smoke test is not optional ceremony.
- Checklist gate: [`01_PRODUCTION_CHECKLIST.md`](01_PRODUCTION_CHECKLIST.md).

## Monitoring & logs (current reality — no APM yet)
- **Uptime/health:** `GET /api/health` (DB status + latency). Free external ping (UptimeRobot-class) on this endpoint is backlog P2 — set it up when you stop checking manually.
- **App logs:** Vercel → project → Logs. Errors are logged with IDs, never PII (by design — keep it that way in any new code).
- **DB:** Neon console (storage, connections, query time).
- **Email:** Resend dashboard (deliveries, bounces).
- **Files:** UploadThing dashboard (storage, requests).
- **Audit:** `ModerationEvent` table — the permanent record of every moderation decision and report.

## Moderation authority
Rules of conduct in [`06_MODERATION_RUNBOOK.md`](06_MODERATION_RUNBOOK.md). Two hard rules for any admin:
1. Never change a product's `moderationStatus` directly in the database — always through the queue/API so the audit log stays complete.
2. Rejections without written reasons don't exist (the API enforces it; don't route around it).

## Emergency shutdown (in escalating order)
1. **Payments only:** set `PRE_LAUNCH_MODE=true` → redeploy. Checkout returns 503; site stays fully up. *This is the switch you'll actually use.*
2. **One seller:** `Shop.isActive=false` — everything they have disappears from public view instantly.
3. **Whole site:** Vercel → Deployments → promote a known-safe deployment; or Vercel → project → Pause (hard stop, use only for active harm).
4. **Data emergency:** rotate `DATABASE_URL` password at Neon — severs all app access to the DB while you think.

## The one-page mental model
Vercel runs the app. Neon holds the truth. UploadThing holds the files. Resend sends the mail. `PRE_LAUNCH_MODE` guards the money. `ADMIN_EMAILS` guards the gate. The audit log remembers everything. Backups are a rumor until you've restored one this month.
