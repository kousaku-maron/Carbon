# Carbon

認証付きのローカル knowledge base / Markdown ノートアプリです。  
Tauri デスクトップアプリとして動作し、ローカル Vault を開いて Markdown・画像・動画・PDF を一つのワークスペースで扱えます。

## できること

- better-auth ベースのログイン / サインアップ
- ローカル Vault フォルダの選択
- ファイルツリー表示とファイル操作
- TipTap ベースの Markdown エディタ
- ノート内リンクの補完と内部遷移
- 画像 / 動画 / PDF の埋め込み表示
- 画像 / 動画 / PDF のモーダル拡大表示
- 単体ファイルとしての画像 / 動画 / PDF ビューア
- PDF の縦スクロール表示とショートカットズーム
- Tauri updater による GitHub Releases ベースの自動更新

## 対応ファイル

- `.md`: NoteEditor
- 画像: 単体ビューア + エディタ埋め込み
- 動画: 単体ビューア + エディタ埋め込み
- `.pdf`: 単体ビューア + エディタ埋め込み

現状、`.pptx` はサポートしていません。

## リポジトリ構成

- `app`: Tauri デスクトップアプリ
  - React
  - Vite
  - TanStack Router
  - TipTap
- `backend`: Cloudflare Workers 上の API
  - Hono
  - better-auth
  - Drizzle ORM
  - Neon / PostgreSQL
- `docs`: 設計メモ、移行方針、実装計画

## 前提

- Node.js 20+
- pnpm
- Rust / Tauri 開発環境
- PostgreSQL
- Cloudflare Workers を動かせる環境

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

`.dev.vars` の主な項目:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `CORS_ORIGINS`

### 3. DB マイグレーション

```bash
pnpm db:migrate
```

### 4. app 環境変数を設定

```bash
cd app
cp .env.example .env
```

必要に応じて `VITE_API_BASE_URL` を変更してください。  
通常は開発時 `http://localhost:8787` です。

画像・動画のドラッグ&ドロップ / ペースト時は、Vault 内の `.carbon/assets/` にファイルを保存し、ノートには `/.carbon/assets/...` 形式の Vault ルート基準 Markdown 参照を挿入します。  
既存の `carbon://asset/...` 画像参照の表示解決は互換性のため残しています。

## 開発起動

リポジトリルートで:

```bash
pnpm dev
```

`pnpm dev` は次をまとめて起動します。

1. backend (`wrangler dev`)
2. health check 待機
3. app (`tauri dev`)

デフォルトポート:

- backend: `8787`
- frontend: `1420`

変更したい場合:

```bash
BACKEND_PORT=8791 FRONTEND_PORT=1520 pnpm dev
```

個別起動も可能です。

```bash
pnpm dev:backend
pnpm dev:app
```

## 主要コマンド

```bash
pnpm --filter app typecheck
pnpm --filter app test
pnpm --filter backend typecheck
pnpm build
```

## 実装メモ

- PDF 表示は `pdf.js` ベースです
- ローカル画像 / 動画 / PDF は Tauri FS 経由で扱います
- エディタ埋め込みの media preview は `NoteEditor` 周辺で共通管理しています
- 画像ドロップの host 側イベントは薄く保ち、アップロード / 挿入本体は `CarbonImage` extension 側に寄せています

## 自動更新

Tauri v2 updater を有効化しています。

- endpoint: `https://github.com/kousaku-maron/Carbon/releases/latest/download/latest.json`
- config: `app/src-tauri/tauri.conf.json`
- startup check: `app/src/lib/updater.ts`

初回セットアップ:

1. 署名鍵を生成

```bash
cd app
pnpm tauri signer generate -w ~/.tauri/carbon.key
```

2. 公開鍵を `app/src-tauri/tauri.conf.json` に設定
3. GitHub Actions / Release 用 Secret を設定

## 主なドキュメント

- `docs/local-markdown-pivot-design.md`
- `docs/local-page-link-design.md`
- `docs/image-dnd-r2-design.md`
- `docs/file-operation-stability-plan.md`
- `docs/tiptap-markdown-unification-policy.md`
