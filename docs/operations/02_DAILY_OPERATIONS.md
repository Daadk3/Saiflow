# Daily Operations

Saiflow is run by one person with a full-time job. The daily loop is **≤ 15 minutes**; if it regularly takes longer, automate or escalate the cause into [`10_FUTURE_BACKLOG.md`](10_FUTURE_BACKLOG.md).

## Morning checklist (~15 min, with coffee)

| # | Check | Where | Act on |
|---|---|---|---|
| 1 | Site up | `saiflow.io/api/health` | Not 200 → [`03_INCIDENT_RESPONSE.md`](03_INCIDENT_RESPONSE.md) |
| 2 | Moderation queue | `/dashboard/moderation` | Review every PENDING product — target: queue empty daily |
| 3 | Reports | support@ inbox (`[Report]` subject) | Follow [`06_MODERATION_RUNBOOK.md`](06_MODERATION_RUNBOOK.md) per category |
| 4 | Support inbox | support@saiflow.io | Reply within 1 business day ([`07_CUSTOMER_SUPPORT.md`](07_CUSTOMER_SUPPORT.md) templates) |
| 5 | Errors | Vercel → Logs (filter: error) | New/repeating errors → note pattern; spike → incident |
| 6 | Email delivery | Resend dashboard → failures | Bounced receipts/resets → verify address, resend manually |
| 7 | New sellers | DB or dashboard | Post-launch: eyeball each new shop for obvious bad faith |
| 8 | Suspicious activity | Vercel logs | Repeated 429s (brute force), 403 download storms, mass signups → [`05_SECURITY_RUNBOOK.md`](05_SECURITY_RUNBOOK.md) |

Orders and payouts join this list when payments go live (check Moyasar dashboard: settlements, chargebacks, disputes).

## Weekly (~30 min, pick a fixed day)

- [ ] Review the week's `ModerationEvent` rows — any pattern in rejections/reports?
- [ ] Neon dashboard: storage growth, connection errors
- [ ] UploadThing dashboard: storage vs plan limit
- [ ] npm audit — new criticals only (fixes wait for a release, not a hotfix)
- [ ] Skim analytics (when added): traffic sources, top products
- [ ] 5-number founder report (per Board framework): visitors, signups, products, sales, revenue

## Monthly (~1 hour)

- [ ] Restore drill: create a Neon branch from a point-in-time — confirm data is there ([`04_BACKUP_AND_RECOVERY.md`](04_BACKUP_AND_RECOVERY.md))
- [ ] Rotate any credential older than 90 days if exposure is suspected (otherwise quarterly)
- [ ] Review `ADMIN_EMAILS` — remove anyone who no longer needs access
- [ ] Legal drift check: policies still match reality? (new features, new processors)
- [ ] Costs: Vercel / Neon / UploadThing / Resend spend vs revenue
- [ ] Re-read [`10_FUTURE_BACKLOG.md`](10_FUTURE_BACKLOG.md) — promote/demote one item deliberately, not by mood
