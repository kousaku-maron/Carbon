# Carbon Markdown Manager (Turborepo)

Astro 単体のフルスタック構成で、Cloudflare Workers + Neon(PostgreSQL) + better-auth を使う最小マークダウン管理ツールです。  
フロントエンドは `@astrojs/preact` と `tailwindcss` に対応しています。  
モノレポ管理は Turborepo です。

## 構成

- `frontend/`: Astro Webアプリ (UI + API routes)
- `frontend/db/schema/auth.ts`: better-auth schema（生成ファイル）
- `frontend/db/schema/app.ts`: アプリ固有schema
- `frontend/db/schema/index.ts`: Drizzle統合エントリ
- `frontend/db/migrations/`: Drizzle migrations
- `turbo.json`: Turborepo pipeline

## セットアップ

```bash
pnpm install
cp frontend/.dev.vars.example frontend/.dev.vars
```

### 1. Neon を準備

1. NeonでDBを作成
2. 接続文字列を取得 (`postgresql://...`)

### 2. 環境変数を設定

`frontend/.dev.vars` の以下を設定:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET` (十分に長いランダム文字列)
- `BETTER_AUTH_URL` (例: `http://127.0.0.1:4321`)
- `BETTER_AUTH_TRUSTED_ORIGINS` (任意。例: `http://localhost:4321,http://127.0.0.1:4321`)
- `GITHUB_CLIENT_ID` (GitHub OAuth App の Client ID)
- `GITHUB_CLIENT_SECRET` (GitHub OAuth App の Client Secret)

GitHub OAuth App の callback URL は `BETTER_AUTH_URL` に合わせて設定してください:

- Local: `http://127.0.0.1:4321/api/auth/callback/github`
- Production: `https://your-domain.example/api/auth/callback/github`

### 3. Drizzle マイグレーション実行

```bash
pnpm db:migrate
```

better-auth schema を再生成する場合:

```bash
pnpm db:auth:generate
```

スキーマ変更時は `pnpm db:generate` で新規マイグレーションを生成。

### 4. 開発起動

```bash
pnpm dev
```

- App: `http://127.0.0.1:4321`

CI/確認用:

```bash
pnpm typecheck
pnpm build
```

## Cloudflare Deploy

`frontend/wrangler.toml` の `BETTER_AUTH_URL` を本番URLへ変更し、secret を登録:

```bash
cd frontend
wrangler kv namespace create SESSION
wrangler secret put DATABASE_URL
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
pnpm deploy
```

`wrangler kv namespace create SESSION` の結果で表示されるIDを、`frontend/wrangler.toml` の `TODO_SESSION_KV_NAMESPACE_ID` に設定してください。

## API

- `GET /api/health`
- `GET /api/me`
- `GET /api/notes`
- `GET /api/notes/:id`
- `POST /api/notes`
- `PATCH /api/notes/:id`
- `DELETE /api/notes/:id`
- `POST|GET /api/auth/*` (better-auth)

## 備考

- ログインは `/login` から実行できます（GitHub OAuth のみ対応）。
- `/signup` は `/login` にリダイレクトされます。
- ノート作成にはログインが必要です。
- ノートの更新/削除は投稿者本人のみ可能です。
