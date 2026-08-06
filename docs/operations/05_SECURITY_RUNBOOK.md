# Security Runbook

What exists today, then how to respond. Full audit history: `RELEASE_v1.0.md`.

**Current defenses:** IP rate limits (login 5/min, signup 3/h, reset 3/h, reports 5/h — in-memory, per-instance), generic auth errors, bcrypt, signature-verified webhooks, order-gated downloads, allowlisted asset URLs, auth-gated uploads, security headers, PII-free logs, append-only moderation audit.

**Known weakness to remember in every response below:** rate limits reset per serverless instance — they slow attackers, they don't stop determined ones. Redis-backed limiting is backlog P1.

## Responses

### Brute-force / credential stuffing
*Signal:* repeated 429s or auth failures in Vercel logs, one IP or rotating IPs.
1. Confirm scope: which accounts targeted? Any successes (200 after many 401s)?
2. Success suspected → reset that user's password (set `resetToken` flow), email them.
3. Sustained attack → enable **Vercel WAF / Attack Challenge Mode** (project → Firewall) — this is the real defense, use it without hesitation.
4. Persistent single-source → IP block rule in Vercel Firewall.

### Spam signups / fake accounts
*Signal:* burst of users with no shops/products, throwaway domains.
1. Confirm they're inert (no products) — if they carry products, treat as seller abuse below.
2. Delete obvious batches directly in DB; note the pattern (domain, timing).
3. Recurring → Vercel Firewall challenge on `/signup`, or tighten the signup rate limit constant in `lib/rate-limit.ts` (one-line change, release process applies).

### Seller abuse (policy-violating catalog, re-uploading rejected content)
1. Everything through the moderation queue — never publish-then-check; the PENDING default is the control.
2. Repeat offender: `Shop.isActive=false` (hides all their products instantly) + record a `ModerationEvent` with the reasoning.
3. Ban = suspend shop + reject products. Account deletion only on their request (PDPL) — a banned seller's audit trail must survive.

### Large / abusive uploads
*Signal:* UploadThing storage spiking, single seller uploading many max-size files.
1. Per-file caps already enforced by UploadThing config (512 MB max).
2. Storage abuse → suspend the shop, delete the files in UploadThing dashboard, note in audit log.
3. Recurring cost problem → per-seller quotas (backlog, Tier 1 T&S).

### Malware in a product
See [`03_INCIDENT_RESPONSE.md`](03_INCIDENT_RESPONSE.md) + [`06_MODERATION_RUNBOOK.md`](06_MODERATION_RUNBOOK.md). Never open the file locally; REJECT first; VirusTotal-scan the URL; suspend on confirmation; email purchasers with plain guidance (delete the file; no attachment).

### Suspicious download patterns
*Signal:* one order's download link hammered from many IPs (link shared publicly).
1. Confirm in logs (`Download authorized: product=… order=…` frequency).
2. Today's tooling: nothing per-link — accept for v1 (links are order-bound, not secret-bound).
3. This is the trigger to promote **signed expiring download URLs** from backlog P1 to *now*.

### Credential / secret leak (key in a commit, a screenshot, a paste)
Rotate first, investigate second — rotation is cheap, exposure is not.
1. Rotate the leaked secret at its source (Neon password / Resend key / UploadThing token / `NEXTAUTH_SECRET`).
2. Update Vercel env → redeploy.
3. `NEXTAUTH_SECRET` rotation logs everyone out — acceptable; announce nothing, it reads as a session expiry.
4. Check logs for use of the leaked credential during the exposure window; if data was accessed → breach playbook.
5. If it was committed to git: rotate anyway even after history rewrite — assume scraped within seconds.

## Standing hygiene
- Quarterly: rotate `NEXTAUTH_SECRET` + provider keys; prune `ADMIN_EMAILS`.
- Never share the admin account; admins use their own emails (the audit log records the actor).
- Every security decision that changes state should leave a trace — prefer actions that write `ModerationEvent` rows over silent DB edits.
