# Setup Guide (Turborepo + Astro Fullstack + Workers + Neon + better-auth)

## Prerequisites

- Node.js 20+
- pnpm
- Cloudflare account
- Neon account

## 1. Install

```bash
pnpm install
cp frontend/.dev.vars.example frontend/.dev.vars
```

## 2. Prepare Neon

1. Create database on Neon
2. Copy `DATABASE_URL`

## 3. Configure app env

Edit `frontend/.dev.vars`:

```bash
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=replace-with-random-string-at-least-32-characters
BETTER_AUTH_URL=http://127.0.0.1:4321
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:4321,http://127.0.0.1:4321
GITHUB_CLIENT_ID=replace-with-github-oauth-client-id
GITHUB_CLIENT_SECRET=replace-with-github-oauth-client-secret
```

Create a GitHub OAuth App and set callback URL to:

- Local: `http://127.0.0.1:4321/api/auth/callback/github`
- Production: `https://<your-domain>/api/auth/callback/github`

## 4. Run Drizzle migration

```bash
pnpm db:migrate
```

When you update better-auth config and need schema regeneration:

```bash
pnpm db:auth:generate
```

When schema changes, generate a new migration with:

```bash
pnpm db:generate
```

## 5. Run app

```bash
pnpm dev
```

## 6. Sign in and create first note

1. Open `http://127.0.0.1:4321/login`
2. Sign in with GitHub OAuth
3. Open `http://127.0.0.1:4321/notes/new`
4. Create your first markdown note
