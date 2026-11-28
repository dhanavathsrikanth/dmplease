# dmplease

> High-conversion Instagram comment-to-DM automation platform built on Next.js 16, Supabase Auth & PostgreSQL, and Meta Graph API v21.0.

## 🚀 Overview

**dmplease** empowers creators and businesses to automatically convert Instagram post comments and story mentions into direct message conversations with zero latency. When followers comment specified keywords (e.g., `GUIDE`, `VIP`, `CALL`), dmplease delivers instant, personalized direct messages with resources, discount codes, or calendar booking links.

---

## ⚡ Features

- **Meta Graph API Unified OAuth 2.1**: One-click authorization linking Instagram Business / Creator accounts with automatic 60-day token upgrades and AES-256-GCM vault encryption.
- **Real-Time Comment & Story Webhooks**: Instant event ingestion verifying HMAC-SHA256 signatures with fallback queuing.
- **Visual Campaign Builder**: Real-time interactive phone simulator, reel picker directly from Instagram media, and keyword pill manager.
- **Supabase OAuth 2.1 Server**: Built-in OAuth Server and Consent Screen (`/oauth/consent`) to act as an identity provider for third-party integrations.
- **Live Performance Dashboard**: Complete conversion metrics, delivery logs, keyword distribution, and Meta rate limit diagnostics.
- **Strict Data Privacy**: Full one-click disconnect that unlinks Meta webhooks and purges credentials from database.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org) (App Router, Turbopack, Server Actions)
- **Database & Auth**: [Supabase](https://supabase.com) (PostgreSQL, Row Level Security, Supabase Auth SSR)
- **ORM**: [Prisma](https://www.prisma.io/)
- **UI Components**: [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), Lucide Icons
- **Security**: AES-256-GCM token encryption, timing-safe HMAC verification

---

## 📦 Getting Started

### Prerequisites
- Node.js 24.x (see `engines` in `package.json`)
- npm 11+

### 1. Clone repository
```bash
git clone https://github.com/dhanavathsrikanth/dmplease.git
cd dmplease
```

### 2. Install dependencies
```bash
npm ci
```

`npm ci` installs exactly the versions and integrity hashes in
`package-lock.json` and fails if the lockfile is out of sync. Use
`npm install <pkg>` only when intentionally changing dependencies; `.npmrc`
saves exact versions so a new package cannot float to a mutable dist-tag.

### 3. Environment Variables
Create `.env.local` and configure your credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-key>
DATABASE_URL="postgresql://postgres:<password>@<host>:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:<password>@<host>:5432/postgres"

# Meta / Instagram Developer App
META_APP_ID=<your-app-id>
META_APP_SECRET=<your-app-secret>
META_CONFIG_ID=<your-config-id>
META_VERIFY_TOKEN=<your-webhook-verify-token>
TOKEN_VAULT_SECRET=<your-32-byte-hex-key>

# Public Domain
NEXT_PUBLIC_SITE_URL=https://your-domain.vercel.app
APP_URL=https://your-domain.vercel.app
```

### 4. Run database migrations
```bash
npx prisma generate
```

### 5. Start development server
```bash
npm run dev
```

---

## 🚢 Deploy to Vercel

1. Push your repository to GitHub.
2. Import the project into **[Vercel](https://vercel.com)**.
3. Add the environment variables from your `.env.local`.
4. Deploy!
