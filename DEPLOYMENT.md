# Vercel Deployment Guide for Saiflow

This guide walks you through deploying Saiflow to Vercel.

## 📋 Pre-Deployment Checklist

- [ ] GitHub repository created and code pushed
- [ ] Neon DB account created with production database
- [ ] Stripe account with production API keys
- [ ] UploadThing account with production token
- [ ] Domain name (optional, Vercel provides free `.vercel.app` subdomain)

---

## 🔐 Environment Variables for Vercel

Add these environment variables in Vercel Dashboard → Project → Settings → Environment Variables.

### Database (Neon DB)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string from Neon | `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require` |

**How to get it:**
1. Go to [Neon Console](https://console.neon.tech)
2. Select your project
3. Click "Connection Details"
4. Copy the connection string (with password shown)

---

### NextAuth.js

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXTAUTH_URL` | Your production URL | `https://saiflow.vercel.app` or `https://saiflow.io` |
| `NEXTAUTH_SECRET` | Random secret for JWT encryption | `K7gNz8xQ...` (32+ characters) |

**How to generate NEXTAUTH_SECRET:**
```bash
openssl rand -base64 32
```

Or use: https://generate-secret.vercel.app/32

---

### Stripe (Production Keys)

| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe secret key (live mode) | `sk_live_51ABC...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | `whsec_ABC123...` |

**How to get Stripe keys:**
1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Toggle to **Live mode** (top right)
3. Go to Developers → API Keys
4. Copy the **Secret key**

**How to set up Stripe Webhook:**
1. Go to Developers → Webhooks
2. Click "Add endpoint"
3. Enter URL: `https://your-domain.com/api/webhooks/stripe`
4. Select event: `checkout.session.completed`
5. Click "Add endpoint"
6. Copy the **Signing secret**

---

### UploadThing

| Variable | Description | Example |
|----------|-------------|---------|
| `UPLOADTHING_TOKEN` | UploadThing API token | `eyJhcGlLZXkiOi...` |

**How to get it:**
1. Go to [UploadThing Dashboard](https://uploadthing.com/dashboard)
2. Select your app (or create one)
3. Go to API Keys
4. Copy the token

---

## 📝 Complete Environment Variables List

Copy this template and fill in your values:

```env
# Database
DATABASE_URL="postgresql://username:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require"

# NextAuth
NEXTAUTH_URL="https://saiflow.io"
NEXTAUTH_SECRET="your-generated-secret-min-32-chars"

# Stripe (LIVE keys for production)
STRIPE_SECRET_KEY="sk_live_your_stripe_live_secret_key"
STRIPE_WEBHOOK_SECRET="whsec_your_webhook_signing_secret"

# UploadThing
UPLOADTHING_TOKEN="your_uploadthing_token"
```

---

## 🚀 Deployment Steps

### Step 1: Push to GitHub

```bash
# Initialize git (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Saiflow"

# Add remote (replace with your repo URL)
git remote add origin https://github.com/yourusername/saiflow.git

# Push
git push -u origin main
```

### Step 2: Import to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository
4. Vercel will auto-detect Next.js

### Step 3: Configure Environment Variables

1. Before deploying, click **"Environment Variables"**
2. Add each variable from the list above
3. Make sure to add them for **Production**, **Preview**, and **Development** environments

### Step 4: Deploy

1. Click **"Deploy"**
2. Wait for the build to complete (2-5 minutes)
3. Your app will be live at `https://your-project.vercel.app`

### Step 5: Run Database Migrations

After first deployment, run migrations:

```bash
# Option 1: Using Vercel CLI
npx vercel env pull .env.production.local
npx prisma migrate deploy

# Option 2: Using Vercel Dashboard
# Go to Project → Settings → Functions → Console
# Run: npx prisma migrate deploy
```

### Step 6: Set Up Stripe Webhook

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Click **"Add endpoint"**
3. Enter your webhook URL:
   ```
   https://saiflow.io/api/webhooks/stripe
   ```
4. Select events to listen to:
   - `checkout.session.completed`
5. Click **"Add endpoint"**
6. Copy the **Signing secret**
7. Update `STRIPE_WEBHOOK_SECRET` in Vercel environment variables
8. **Redeploy** the project for changes to take effect

### Step 7: Configure Custom Domain (Optional)

1. Go to Project → Settings → Domains
2. Add your custom domain
3. Follow DNS configuration instructions
4. Update `NEXTAUTH_URL` to your custom domain
5. Update Stripe webhook URL to use custom domain

---

## ✅ Post-Deployment Checklist

- [ ] Website loads at Vercel URL
- [ ] Can create an account (signup works)
- [ ] Can log in (authentication works)
- [ ] Can create a shop
- [ ] Can add a product with file upload
- [ ] Can view public shop page
- [ ] Stripe checkout works (test with Stripe test card)
- [ ] Webhook creates order after payment
- [ ] Download works after purchase
- [ ] Sales dashboard shows orders

---

## 🔧 Troubleshooting

### Database Connection Errors

- Verify `DATABASE_URL` is correct
- Check Neon dashboard for connection status
- Ensure `?sslmode=require` is in the URL

### Authentication Issues

- Verify `NEXTAUTH_URL` matches your deployment URL exactly
- Check `NEXTAUTH_SECRET` is set and at least 32 characters
- Clear browser cookies and try again

### Stripe Webhook Not Working

- Verify webhook URL is correct: `https://your-domain/api/webhooks/stripe`
- Check webhook signing secret matches
- View webhook logs in Stripe Dashboard → Developers → Webhooks → Select endpoint → Logs

### File Upload Errors

- Verify `UPLOADTHING_TOKEN` is correct
- Check UploadThing dashboard for errors
- Ensure your domain is allowed in UploadThing settings

### Build Failures

- Check Vercel build logs for errors
- Ensure all environment variables are set
- Try running `npm run build` locally first

---

## 📊 Monitoring

### Vercel Analytics

Enable in Project → Analytics for:
- Page views
- Performance metrics
- Error tracking

### Stripe Dashboard

Monitor in Stripe Dashboard:
- Payments
- Webhook deliveries
- Failed payments

### Neon Dashboard

Monitor in Neon Console:
- Database connections
- Query performance
- Storage usage

---

## 🔄 Updating Your Deployment

After making changes:

```bash
git add .
git commit -m "Your update message"
git push
```

Vercel will automatically redeploy on every push to main branch.

---

## 💰 Cost Estimates

| Service | Free Tier | Paid |
|---------|-----------|------|
| Vercel | 100GB bandwidth/month | $20/month Pro |
| Neon DB | 0.5GB storage, 1 project | $19/month |
| Stripe | No monthly fee | 2.9% + $0.30 per transaction |
| UploadThing | 2GB storage | $10/month |

**Total for starting out: $0/month** (within free tiers)
