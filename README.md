# Carbon

認証付きローカル Markdown 管理アプリです。  
このリポジトリは `tauri-cloudflare-todo` テンプレートを土台に、カンバン機能からピボットしています。

## 現在の構成

- `app`: Tauri デスクトップアプリ (React + Vite + TanStack Router)
  - ログイン/サインアップ
  - ローカルフォルダ（Vault）選択
  - ファイルツリー表示
  - TipTap ベース Markdown エディタ
- `backend`: Hono API on Cloudflare Workers
  - better-auth (email/password + bearer token)
  - Neon(PostgreSQL) + Drizzle ORM
  - 認証API (`/api/auth/*`, `/api/me`)

## 前提

- Node.js 20+
- pnpm
- PostgreSQL (Neon 推奨)

## セットアップ

### 1. 依存関係をインストール

```bash
pnpm install
```

### 2. backend 環境変数を設定

```bash
cd backend
cp .dev.vars.example .dev.vars
```

`.dev.vars` に以下を設定します。

- `DATABASE_URL`: PostgreSQL 接続文字列
- `BETTER_AUTH_SECRET`: 十分に長いランダム文字列
- `BETTER_AUTH_URL`: 開発時は `http://localhost:8787`
- `CORS_ORIGINS`: 開発時は `http://localhost:1420,tauri://localhost`

### 3. DB マイグレーションを適用

```bash
cd backend
pnpm db:migrate
```

### 4. app 環境変数を設定

```bash
cd app
cp .env.example .env
```

必要に応じて `VITE_API_BASE_URL` を変更してください（デフォルト: `http://localhost:8787`）。

## 開発起動

リポジトリルートで実行:

```bash
pnpm dev
```

`pnpm dev` は以下を自動で行います。

1. backend (`wrangler dev`) 起動
2. `/api/health` が返るまで待機
3. app (`tauri dev`) 起動

デフォルトポート:

- backend: `8787`
- frontend: `1420`

必要なら次のように変更できます。

```bash
BACKEND_PORT=8791 FRONTEND_PORT=1520 pnpm dev
```

## ビルド / チェック

```bash
pnpm --filter app typecheck
pnpm --filter backend typecheck
pnpm build
```

## Tauri 自動更新（GitHub Releases）

このリポジトリは Tauri v2 updater を有効化済みです。

- endpoint: `https://github.com/kousaku-maron/Carbon/releases/latest/download/latest.json`
- 設定ファイル: `app/src-tauri/tauri.conf.json`
- 起動時チェック: `app/src/lib/updater.ts`

初回セットアップ:

1. アップデート署名鍵を生成

```bash
cd app
pnpm tauri signer generate -w ~/.tauri/carbon.key
```

2. 生成された公開鍵を `app/src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に設定

3. GitHub Secrets を設定（`release.yml` で使用）
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `DEVELOPER_CERT_BASE64`
- `DEVELOPER_CERT_PASSPHRASE`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

`release.yml` は `.dmg` に加えて updater 用アーティファクト（`*.tar.gz`, `*.sig`）と `latest.json` を Release Asset に添付します。

## API（現在利用）

- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-out`
- `GET /api/me`
- `GET /api/health`

## ドキュメント

- `docs/local-markdown-pivot-design.md`: ワイヤーフレーム設計
- `docs/image-dnd-r2-design.md`: 画像D&D / R2 設計
- `docs/tiptap-markdown-unification-policy.md`: TipTap Markdown 統一方針（v3 最新化）
