# Production Checklist

Run top to bottom before **every** production deployment. Full deploy mechanics: [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md).

## Environment
- [ ] All 7 required env vars set in Vercel (Production scope): `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `UPLOADTHING_TOKEN`, `RESEND_API_KEY`, `PRE_LAUNCH_MODE`, `ADMIN_EMAILS`
- [ ] `PRE_LAUNCH_MODE` is the value you intend (`true` = checkout off). Verify — this flag is the money switch.
- [ ] No secrets in code, logs, or commit history (spot-check the diff)

## Database
- [ ] Pending migrations reviewed — additive? If destructive: take a Neon snapshot/branch first
- [ ] Migration will run via build (`prisma migrate deploy`) — no manual step
- [ ] After deploy: `npx prisma migrate status` shows no pending migrations

## Deployment
- [ ] Preview deployed and smoke-tested (`docs/DEPLOYMENT.md §4`) before promoting
- [ ] Production build green in Vercel; no new build warnings vs last release

## Domain, DNS & Email
- [ ] `saiflow.io` + `www` resolve to Vercel; SSL valid (padlock, no warnings)
- [ ] `NEXTAUTH_URL` matches the exact production domain (Google OAuth breaks otherwise)
- [ ] Resend: domain `saiflow.io` verified (SPF + DKIM green in Resend dashboard)
- [ ] Send a real password-reset email → arrives, link works
- [ ] `support@saiflow.io` receives inbound mail (send one test)

## Services
- [ ] UploadThing: token valid; upload a test image via dashboard flow; file accessible
- [ ] `/api/health` → 200, `database.status: "up"`, latency sane (<300ms)

## Security
- [ ] Response headers present: `X-Frame-Options: DENY`, `nosniff`, HSTS (curl or browser devtools)
- [ ] `/api/debug-*` routes: none exist (verify 404)
- [ ] `GET /api/download/<any-id>` without order → 403
- [ ] `/dashboard` logged out → redirect to login

## Moderation
- [ ] `ADMIN_EMAILS` includes the active admin(s)
- [ ] `/dashboard/moderation` loads for admin; 403 for non-admin
- [ ] Test product submission lands as PENDING, not public

## Payments (when Moyasar is live — future)
- [ ] Moyasar keys set (live, not test); webhook URL registered and signature-verified
- [ ] 1 SAR end-to-end test purchase → order created → download works → refund the riyal
- [ ] `PRE_LAUNCH_MODE=false` only after the line above passes

## Rollback readiness
- [ ] Previous good deployment identified in Vercel (know which one you'd promote back)
- [ ] Kill switch understood: `PRE_LAUNCH_MODE=true` + redeploy stops all payments without downtime
