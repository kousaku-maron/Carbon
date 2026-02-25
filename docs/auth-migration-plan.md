# 認証アーキテクチャ（Google OAuth）

## 1. 概要

デスクトップアプリ（Tauri v2 + macOS）向けの Google OAuth 認証。
システムブラウザで Google 認証を行い、deep link またはポーリングでトークンをアプリに渡す。

## 2. 構成

### Backend（Cloudflare Workers + Hono）

| ファイル | 役割 |
|---------|------|
| `backend/src/auth.ts` | better-auth 設定（Google provider, bearer plugin） |
| `backend/src/desktop-auth.ts` | デスクトップ向け OAuth フロー（サブアプリ） |
| `backend/src/index.ts` | Hono ルーティング、`/api/desktop-auth` にマウント |

### App（Tauri v2 + React）

| ファイル | 役割 |
|---------|------|
| `app/src/lib/api/auth.ts` | 認証ロジック（signInWithGoogle, signOut, fetchMe, トークン管理） |
| `app/src/lib/api/client.ts` | 汎用 HTTP クライアント（Bearer ヘッダ自動付与） |
| `app/src/lib/api/index.ts` | barrel exports |
| `app/src/router.tsx` | ルーティング + deep link ハンドラ + 認証ガード |
| `app/src/routes/login-route.tsx` | ログイン UI（Google ボタンのみ） |

## 3. 認証フロー

### PROD モード（deep link）

ビルド済み .app で利用。`VITE_AUTH_EXCHANGE` 未設定時のデフォルト。

```
1. アプリ: openUrl("http://.../api/desktop-auth/google")
2. ブラウザ: Google OAuth 認証
3. Backend: /api/desktop-auth/callback でセッション取得
4. ブラウザ: carbon://callback?token=xxx にリダイレクト
5. macOS: deep link でアプリを起動/フォーカス
6. アプリ: router.tsx の RootComponent が token を受け取り、persistToken → /workspace
```

### DEV モード（ポーリング）

`tauri dev` では deep link が動作しないため、ポーリング方式を使用。
`VITE_AUTH_EXCHANGE=true` + `AUTH_EXCHANGE_ENABLED=true` で有効化。

```
1. アプリ: exchange コード（UUID）を生成
2. アプリ: openUrl("http://.../api/desktop-auth/google?exchange=xxx")
3. ブラウザ: Google OAuth 認証
4. Backend: /api/desktop-auth/callback で token を verification テーブルに保存
5. アプリ: /api/desktop-auth/exchange?code=xxx を 2 秒間隔でポーリング
6. token 取得 → persistToken → /workspace に遷移
```

タイムアウト: 1 分（AbortController で制御）

## 4. トークン管理

```
[起動] → restoreToken() → LazyStore("auth.json") → cachedToken (メモリ)
[ログイン] → persistToken(token) → cachedToken + LazyStore 同時書き込み
[API リクエスト] → getCachedToken() → Authorization: Bearer ヘッダ付与
[ログアウト] → signOut() → POST /api/auth/sign-out + persistToken(null)
```

- `LazyStore`（@tauri-apps/plugin-store）は非同期のため、メモリキャッシュ `cachedToken` を介して同期的に読み出し
- `request()` が全 API リクエストに Bearer ヘッダを自動付与

## 5. ルーティング（認証ガード）

`rootRoute.beforeLoad` で一元管理:

```ts
const user = await fetchMe();
if (user && isLoginPage) → redirect /workspace
if (!user && !isLoginPage) → redirect /login
```

- `fetchMe()` が 1 回で認証チェック完了
- 個別ルートに `beforeLoad` は不要

## 6. Backend エンドポイント

| エンドポイント | 説明 |
|-------------|------|
| `GET /api/desktop-auth/google` | Google OAuth 開始（exchange パラメータはオプション） |
| `GET /api/desktop-auth/callback` | OAuth コールバック → deep link ページ表示 |
| `GET /api/desktop-auth/exchange` | ポーリング用トークン取得（DEV モードのみ） |
| `ALL /api/auth/*` | better-auth 内部ルート（直接呼ばない） |
| `GET /api/me` | 現在のユーザー情報取得 |

### 注意事項

- `callbackURL` は **絶対 URL** にすること（`${BETTER_AUTH_URL}/api/desktop-auth/callback`）
  - 内部リクエストには `Origin` ヘッダがないため、相対パスだと better-auth が正しい origin を解決できない
- `skipStateCookieCheck: true` が必要（内部リクエストとブラウザで cookie コンテキストが異なるため）
- Cookie の値と bearer token は異なる → `auth.api.getSession({ headers })` で正しい `session.token` を取得

## 7. 環境変数

### Frontend（`app/.env`）

| 変数 | 説明 | 例 |
|-----|------|-----|
| `VITE_API_BASE_URL` | Backend の URL | `http://localhost:8787` |
| `VITE_AUTH_EXCHANGE` | ポーリング有効化 | `true`（DEV のみ） |

### Backend（`backend/.dev.vars`）

| 変数 | 説明 |
|-----|------|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `AUTH_EXCHANGE_ENABLED` | ポーリング用 exchange エンドポイント有効化（`true` で有効） |

## 8. Tauri 設定

- **Deep link**: `tauri.conf.json` → `plugins.deep-link.desktop.schemes: ["carbon"]`
- **Capabilities**: `deep-link:default`, `opener:default`, `store:default`
- **Plugins（Rust）**: `tauri-plugin-deep-link`, `tauri-plugin-opener`, `tauri-plugin-store`
