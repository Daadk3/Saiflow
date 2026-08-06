# Incident Response

**First rule:** stabilize, then diagnose. **Second rule:** write down what you did (time, action, result) — in the incident, not after.

## Severity

- **SEV1** — money, law, or safety: payments broken, data breach, child-safety content, government order. *Drop everything.*
- **SEV2** — core function down: site offline, DB down, uploads/downloads failing. *Same day.*
- **SEV3** — degraded: emails delayed, one page broken, slow queries. *Within 48h.*

## Playbooks

### Website offline
1. `saiflow.io/api/health` and Vercel status page (`vercel-status.com`).
2. Vercel → Deployments: did a deploy just go out? → **Promote the previous good deployment** (instant rollback).
3. Vercel platform outage → nothing to fix; post a notice if you have a channel; wait.
4. DNS? `dig saiflow.io` — registrar issue if records vanished.

### Database unavailable
1. Health endpoint says `database: down`. Check Neon status + dashboard (paused? compute limit? connection cap?).
2. Public pages degrade gracefully (browse/home render empty); dashboards will error — acceptable during recovery.
3. Neon compute suspended (free-tier idle) → wakes on connection; persistent → Neon support.
4. If data looks *wrong* (not just down) → stop writes: put Vercel deployment into maintenance by promoting a deploy with `PRE_LAUNCH_MODE=true`, then see [`04_BACKUP_AND_RECOVERY.md`](04_BACKUP_AND_RECOVERY.md).

### Uploads failing
1. Try a small test upload; check UploadThing dashboard/status.
2. Token invalid/expired → replace `UPLOADTHING_TOKEN`, redeploy.
3. Plan limit hit → upgrade plan (money) or clean orphaned files (time).
4. Sellers blocked meanwhile: products without files stay unpublishable — no corruption risk. Reply with support template.

### Email provider down (Resend)
1. Resend status/dashboard → failures tab.
2. Domain verification lapsed (DNS change?) → re-verify SPF/DKIM.
3. Purchase receipts failing **post-launch**: buyers still get downloads via the success page — email is a duplicate channel, say so in support replies. Send critical receipts manually from support@ until restored.

### Seller-uploaded malware report
SEV1. See [`06_MODERATION_RUNBOOK.md`](06_MODERATION_RUNBOOK.md) → malware. Short form: unpublish product (set REJECTED via moderation queue) → do NOT download the file to your machine → verify via VirusTotal URL scan if possible → suspend seller (`Shop.isActive=false`) on confirmation → email affected buyers if any purchased.

### Copyright complaint (received at support@)
1. Acknowledge within 24h (template in [`07_CUSTOMER_SUPPORT.md`](07_CUSTOMER_SUPPORT.md)).
2. Ask complainant for: identification of the work, proof of rights, the Saiflow URL.
3. Meanwhile set the product REJECTED (reason: "IP complaint under review") — removal is reversible, infringement liability is not.
4. Forward to seller for response (their certification made them responsible). Genuine license shown → restore; none → stays down; repeat offender → suspend shop.
5. Log everything in `ModerationEvent` reasons.

### Government / authority complaint
SEV1. Do not improvise, do not ignore, do not argue.
1. Verify authenticity (official channel, reference numbers).
2. Comply with any takedown immediately (REJECT the product / disable the shop) — comply first, contest later if warranted.
3. Acknowledge receipt formally in Arabic; note deadlines.
4. Engage a Saudi lawyer before any substantive response beyond compliance.
5. Preserve all records (audit log covers product history).

### Abuse report (harassment, fraud, impersonation)
Follow the report's category in [`06_MODERATION_RUNBOOK.md`](06_MODERATION_RUNBOOK.md). If a person is being harmed (impersonation, doxxing): remove first, investigate second.

### Suspected data breach
SEV1. PDPL obligations apply.
1. Contain: rotate `NEXTAUTH_SECRET` + `DATABASE_URL` password + all API keys immediately; redeploy.
2. Assess: what data, whose, how much, still ongoing? (Vercel + Neon logs.)
3. **Notify SDAIA within 72 hours** of becoming aware (National Data Governance Platform / official channel) — with facts, scope, and mitigation.
4. Notify affected users if their data is at real risk — plainly, in Arabic and English.
5. Engage a lawyer; write the timeline down as you go.
6. Do not delete anything — evidence.

## After every SEV1/SEV2
Ten minutes, honestly: what broke → why → what fixed it → what prevents recurrence (→ backlog). Keep in `docs/operations/incidents/YYYY-MM-DD.md`.
