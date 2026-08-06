# Saiflow — Deployment Runbook

**Target:** Vercel · Next.js 15 · Neon Postgres · branch `CP-prelaunch-honesty` (v1.0 RC)
**Golden rule:** deploy to a **Preview** first, run the smoke test there, then promote. Never skip the preview.

---

## 1. Required environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Value / Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon Postgres connection string (`?sslmode=require`) |
| `NEXTAUTH_URL` | ✅ | `https://www.saiflow.io` (prod) / preview URL for previews |
| `NEXTAUTH_SECRET` | ✅ | `openssl rand -base64 32` — never reuse between environments |
| `UPLOADTHING_TOKEN` | ✅ | UploadThing dashboard |
| `RESEND_API_KEY` | ✅ | starts `re_` — sender domain `saiflow.io` must be verified in Resend |
| `PRE_LAUNCH_MODE` | ✅ | **`true` until payments are live.** Only the literal string `false` opens checkout |
| `ADMIN_EMAILS` | ✅ | Comma-separated moderation admins (the founder's own address) — without it, nothing can be approved |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Google sign-in; redirect URI `https://www.saiflow.io/api/auth/callback/google` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | optional | Dormant integration — omit entirely until a payment decision; app builds and runs without them |

Validation is enforced at boot by `lib/env.ts` — a misconfigured deploy fails fast, not silently.

## 2. Deployment order (first deploy of this RC)

1. **Set env vars** (above) for Preview + Production scopes.
2. **Push the branch** — Vercel builds the Preview automatically.
   Build command (from `vercel.json`): `prisma migrate deploy && prisma generate && next build`.
3. **Database migration runs inside the build** (step 2 — no manual step). This RC applies one migration: `20260718120000_add_moderation`:
   - creates `ModerationStatus`/`ModerationAction` enums + `ModerationEvent` table,
   - adds `moderationStatus` (default `PENDING`) + `certifiedAt` to `Product`,
   - **backfills existing products to `APPROVED`** so nothing already live disappears.
4. **Run the smoke test (§4) against the Preview.**
5. **Promote to Production** (Vercel → Promote) only when §4 is fully green.
6. Re-run §5 against production.

## 3. Rollback procedure

- **App rollback:** Vercel → Deployments → previous good deployment → *Promote to Production*. Instant; no build.
- **Migration note:** `add_moderation` is additive (new columns/tables only) — old app code runs fine against the migrated schema, so app-level rollback is safe without a DB rollback.
- **DB restore (disaster only):** Neon → Branches/Restore → point-in-time restore, then repoint `DATABASE_URL`. Only needed for data corruption, not for app bugs.
- **Kill switch:** if payments ever misbehave post-launch, set `PRE_LAUNCH_MODE=true` and redeploy — checkout returns 503 instantly, site stays up.

## 4. Smoke test checklist (on Preview, with real DB)

**Seller flow**
- [ ] Sign up → log in (wrong password: generic error; 6 rapid failures: throttled)
- [ ] Create shop (try an Arabic-only name — must succeed with a generated handle)
- [ ] Add product: certification checkbox is required; upload file + thumbnail; price in SAR
- [ ] Product shows **"Under review / قيد المراجعة"** badge; NOT visible on `/browse`, homepage, or its public URL
- [ ] As admin: `/dashboard/moderation` lists it → Approve
- [ ] Product now live on `/browse`, its shop page, and its public URL

**Buyer flow**
- [ ] Public product URL loads logged-out; share preview correct (paste URL into WhatsApp — expect product name + thumbnail)
- [ ] Share button: copies link with confirmation (desktop) / opens share sheet (mobile)
- [ ] Buy button disabled with pre-launch message; `POST /api/checkout` → 503
- [ ] `GET /api/download/<productId>` (no order) → 403
- [ ] Report a product → success message; admin email arrives; `ModerationEvent` row created; product still live

**Platform**
- [ ] `/api/health` → 200, database `up`
- [ ] Language switcher: full AR ⇄ EN flip including `<html dir>`
- [ ] `/robots.txt`, `/sitemap.xml` (sitemap includes live shop + product URLs)
- [ ] All footer links resolve (Terms, Privacy, Refunds, Content Policy, About, Contact, Support)
- [ ] 404 page on garbage URL; mobile viewport clean
- [ ] Response headers include `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS

## 5. Production verification (after promote)

- [ ] `https://www.saiflow.io/api/health` → 200
- [ ] Homepage OG card correct (test at opengraph.xyz or paste in WhatsApp)
- [ ] `support@saiflow.io` receives mail (send one) — it is the published legal/report contact
- [ ] Resend domain verified → trigger password-reset email, confirm delivery + link works
- [ ] Vercel logs clean of errors for the first hour
- [ ] `[CR NUMBER]` placeholders in Terms/About replaced with the real registration **before any payment goes live**

## 6. Production configuration notes (verified in this RC)

- **Headers:** security headers set globally in `next.config.ts`; API responses `Cache-Control: no-store` via `vercel.json`.
- **Middleware:** NextAuth guard on `/dashboard/:path*` only — public pages untouched.
- **Image domains:** UploadThing hosts + Google avatars only (`next.config.ts`); upload asset URLs are server-validated against the same allowlist.
- **Compression:** Brotli/gzip automatic on Vercel — no action.
- **Rendering:** pages are dynamic (locale cookie); **ISR intentionally not enabled** in this RC — revisit for `/browse` + product pages if traffic warrants (requires moving locale out of the render path; do not bolt on).
- **CSP (recommended, post-launch):** start with `Content-Security-Policy-Report-Only: default-src 'self'; img-src 'self' data: https://utfs.io https://*.ufs.sh https://*.uploadthing.com https://lh3.googleusercontent.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'` — observe a week of reports, then enforce. Not enabled now: an enforced CSP added at the last minute is how launches break.
- **Region:** `iad1` (US-East). PDPL stance: transfers disclosed in the Privacy Policy; KSA/ME-region migration is a scheduled post-revenue improvement.
