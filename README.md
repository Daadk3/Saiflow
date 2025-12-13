# Saiflow

A modern digital products marketplace built with Next.js, inspired by Gumroad. Sell digital products like ebooks, courses, templates, and more.

![Saiflow](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma)
![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?style=flat-square&logo=stripe)

## Features

- 🏪 **Multi-shop Support** - Create and manage multiple shops
- 📦 **Digital Products** - Upload and sell digital files (PDF, ZIP, EPUB, etc.)
- 💳 **Stripe Payments** - Secure checkout with Stripe
- 📊 **Sales Dashboard** - Track revenue and orders
- 🎨 **Modern Dark UI** - Beautiful dark theme with teal accents
- 📱 **Responsive Design** - Works on all devices
- 🔐 **Authentication** - Secure login with NextAuth.js
- ⬇️ **Instant Downloads** - Customers get immediate access after purchase

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL (Neon)
- **ORM**: Prisma
- **Authentication**: NextAuth.js
- **Payments**: Stripe
- **File Upload**: UploadThing
- **Styling**: Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL database (we recommend [Neon](https://neon.tech))
- Stripe account
- UploadThing account

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/saiflow.git
   cd saiflow
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   # Database
   DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"

   # NextAuth
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="your-nextauth-secret-generate-with-openssl-rand-base64-32"

   # Stripe
   STRIPE_SECRET_KEY="sk_test_your_stripe_secret_key"
   STRIPE_WEBHOOK_SECRET="whsec_your_webhook_secret"

   # UploadThing
   UPLOADTHING_TOKEN="your_uploadthing_token"
   ```

4. **Generate NextAuth Secret**
   ```bash
   openssl rand -base64 32
   ```

5. **Set up the database**
   ```bash
   npx prisma migrate dev
   ```

6. **Run the development server**
```bash
npm run dev
   ```

7. **Open your browser**
   
   Visit [http://localhost:3000](http://localhost:3000)

### Stripe Webhook Setup

For local development, use the Stripe CLI:

1. **Install Stripe CLI**
   ```bash
   brew install stripe/stripe-cli/stripe
   ```

2. **Login to Stripe**
   ```bash
   stripe login
   ```

3. **Forward webhooks to localhost**
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

4. **Copy the webhook signing secret** and add it to your `.env` file

For production, create a webhook endpoint in the Stripe Dashboard:
- URL: `https://your-domain.com/api/webhooks/stripe`
- Events: `checkout.session.completed`

## Project Structure

```
saiflow/
├── app/
│   ├── api/                    # API routes
│   │   ├── auth/               # NextAuth configuration
│   │   ├── checkout/           # Stripe checkout
│   │   ├── download/           # File download after purchase
│   │   ├── orders/             # Orders API
│   │   ├── products/           # Products CRUD
│   │   ├── shops/              # Shops CRUD
│   │   ├── uploadthing/        # File upload
│   │   └── webhooks/           # Stripe webhooks
│   ├── dashboard/              # Seller dashboard
│   │   ├── sales/              # Sales tracking
│   │   ├── shop/               # Shop management
│   │   └── create-shop/        # Create new shop
│   ├── shop/                   # Public shop pages
│   │   └── [slug]/             # Shop storefront
│   │       └── product/        # Product pages
│   ├── login/                  # Login page
│   ├── signup/                 # Signup page
│   └── success/                # Purchase success page
├── lib/
│   ├── prisma.ts               # Prisma client
│   └── uploadthing.ts          # UploadThing config
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── migrations/             # Database migrations
└── public/                     # Static assets
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `NEXTAUTH_URL` | Your app URL (http://localhost:3000 for dev) | Yes |
| `NEXTAUTH_SECRET` | Secret for NextAuth.js sessions | Yes |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_test_... or sk_live_...) | Yes |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | Yes |
| `UPLOADTHING_TOKEN` | UploadThing API token | Yes |

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Add all environment variables
4. Deploy!

### Other Platforms

The app can be deployed to any platform that supports Next.js:
- Railway
- Render
- DigitalOcean App Platform
- AWS Amplify

Make sure to:
1. Set all environment variables
2. Run `npx prisma migrate deploy` for database migrations
3. Update `NEXTAUTH_URL` to your production domain
4. Create a production Stripe webhook endpoint

## Scripts

```bash
# Development
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

# Database
npx prisma migrate dev      # Run migrations (dev)
npx prisma migrate deploy   # Run migrations (prod)
npx prisma studio           # Open Prisma Studio
npx prisma generate         # Generate Prisma Client
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by [Gumroad](https://gumroad.com)
- Built with [Next.js](https://nextjs.org)
- Payments by [Stripe](https://stripe.com)
- Database by [Neon](https://neon.tech)
- File uploads by [UploadThing](https://uploadthing.com)
