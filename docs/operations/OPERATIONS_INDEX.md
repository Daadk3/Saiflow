# Saiflow Operations Center

The operating manual for running Saiflow as a business — not just deploying it as code. One founder-operator, fifteen honest minutes a day, and a playbook for every day that isn't normal.

**Start here if you're new (including future-you):** read 08 → 02 → 01, in that order.

## The manual

| # | Document | One line | Reach for it when |
|---|---|---|---|
| 01 | [Production Checklist](01_PRODUCTION_CHECKLIST.md) | The gate before every production deploy | You're about to ship |
| 02 | [Daily Operations](02_DAILY_OPERATIONS.md) | The ≤15-min daily loop, weekly + monthly rhythms | Every morning |
| 03 | [Incident Response](03_INCIDENT_RESPONSE.md) | Playbooks for outages, complaints, breaches | Something is broken or someone official is writing to you |
| 04 | [Backup & Recovery](04_BACKUP_AND_RECOVERY.md) | Where the data lives, RTO/RPO, disaster plan | Before you need it (monthly drill), and the day you do |
| 05 | [Security Runbook](05_SECURITY_RUNBOOK.md) | Responses to attacks, abuse, and leaks | Logs look wrong |
| 06 | [Moderation Runbook](06_MODERATION_RUNBOOK.md) | Decision trees per category; AI vs human boundaries | Reviewing the queue or a report |
| 07 | [Customer Support](07_CUSTOMER_SUPPORT.md) | SOPs + bilingual templates | Answering support@ |
| 08 | [Admin Guide](08_ADMIN_GUIDE.md) | Everything an administrator must know, incl. emergency shutdown | Onboarding an admin (or re-onboarding yourself) |
| 09 | [Release Process](09_RELEASE_PROCESS.md) | Dev → Preview → smoke → prod → rollback | Any code change is heading to production |
| 10 | [Future Backlog](10_FUTURE_BACKLOG.md) | The prioritized roadmap, P0–P3 + anti-backlog | Deciding what to build next |

## Related documents outside this folder

- [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) — deploy mechanics, env table, smoke-test checklist (§4)
- [`docs/TRUST_AND_SAFETY.md`](../TRUST_AND_SAFETY.md) — moderation architecture, Tier 1/2 blueprints
- [`RELEASE_v1.0.md`](../../RELEASE_v1.0.md) — what shipped, known limitations, roadmap summary

## The three switches to memorize

1. **`PRE_LAUNCH_MODE=true`** + redeploy — stops all payments, site stays up. The money kill switch.
2. **`Shop.isActive=false`** — one seller's entire catalog off the air instantly.
3. **Vercel → promote previous deployment** — the whole app, back to the last good state, in seconds.

*If you only ever read one sentence of this folder: nothing publishes unreviewed, nothing deploys untested, nothing gets decided without a written reason — and the audit log remembers so you don't have to.*
