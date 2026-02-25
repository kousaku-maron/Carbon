# 認証アーキテクチャ移行計画（Email → Google OAuth）

## 1. 背景

現在の認証は email/password ベースで、app 側が `fetch` + 手動トークン管理で実装している。
次のステップとして Google OAuth に切り替える予定があるため、認証フロー全体を `better-auth/client` に移行する。

## 2. 現状の構成

### Backend（`backend/src/auth.ts`）

- `better-auth` + `drizzleAdapter`（PostgreSQL）
- `emailAndPassword: { enabled: true }` で email/password 認証
- `bearer()` plugin でトークンベース認証
- Hono の `app.all("/api/auth/*")` で better-auth にルーティング
- `auth.api.getSession({ headers })` でセッション検証

### App（`app/src/lib/api.ts`）

- `request<T>(path, init)` — 汎用 HTTP クライアント（`Authorization: Bearer` ヘッダを自動付与）
- `getSessionToken()` / `setSessionToken()` — Tauri `LazyStore("auth.json")` でトークン永続化
- `fetchMe()` — `GET /api/me` でセッション検証
- 各ルートが `request()` を直接呼び出し、エンドポイントパス・ボディ構造を知っている

### 消費元

| ファイル | 使用する export |
|---------|---------------|
| `LoginRoute.tsx` | `request`, `setSessionToken` |
| `SignUpRoute.tsx` | `request`, `setSessionToken` |
| `WorkspaceRoute.tsx` | `request`, `setSessionToken` |
| `NoteEditor.tsx` | `API_BASE_URL` |
| `router.tsx` | `fetchMe` |

## 3. 移行方針

### Phase 1: `lib/api/` 分割（現リファクタリング）

認証フローには触れず、汎用 HTTP クライアントのみ切り出す。

```
lib/api/
  client.ts    # request(), API_BASE_URL, getSessionToken(), setSessionToken()
  index.ts     # barrel exports
```

- `api.ts` の `User` 型、`fetchMe()`、各ルートの `request()` 呼び出しはそのまま
- 認証ロジックの書き換えは Phase 2 で行う

### Phase 2: Google OAuth 導入 + `createAuthClient` 移行

#### 2-1. Backend 変更

`backend/src/auth.ts` に Google provider を追加:

```ts
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";

export function createAuth(env: AuthEnv, db: Database) {
  return betterAuth({
    // ...existing config
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    emailAndPassword: {
      enabled: false, // 無効化（または移行期間中は併用）
    },
    plugins: [bearer()],
  });
}
```

#### 2-2. App 側: `createAuthClient` 導入

`app/src/lib/api/auth.ts` を新設:

```ts
import { createAuthClient } from "better-auth/client";
import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("auth.json");
let cachedToken: string | null = null;

// 起動時に LazyStore → メモリキャッシュへ復元
export async function restoreToken(): Promise<void> {
  cachedToken = (await store.get<string>("session_token")) ?? null;
}

async function persistToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (token) {
    await store.set("session_token", token);
  } else {
    await store.delete("session_token");
  }
}

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8787",
  fetchOptions: {
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token) persistToken(token);
    },
    auth: {
      type: "Bearer",
      token: () => cachedToken ?? "",  // 同期コールバック — メモリキャッシュから読む
    },
  },
});
```

#### 2-3. トークン永続化のブリッジ

better-auth client の `fetchOptions.auth.token` は**同期コールバック**だが、Tauri の `LazyStore` は非同期。
これを解決するためにインメモリキャッシュを挟む:

```
[アプリ起動] → restoreToken() → LazyStore → cachedToken (メモリ)
[ログイン成功] → onSuccess → persistToken() → cachedToken + LazyStore 同時書き込み
[API リクエスト] → token() → cachedToken から同期的に読み出し
[ログアウト] → signOut() → persistToken(null) → cachedToken + LazyStore 同時クリア
```

#### 2-4. OAuth リダイレクト処理

Tauri のネイティブアプリでは OAuth コールバックにブラウザリダイレクトが使えないため、
`@daveyplate/better-auth-tauri` でディープリンク経由のリダイレクトを処理する。

必要な Tauri plugin:
- `tauri-plugin-deep-link` — カスタム URL スキームの登録
- `tauri-plugin-http`（必要に応じて）

```ts
// backend
import { tauri } from "@daveyplate/better-auth-tauri/plugin";

plugins: [
  bearer(),
  tauri({ scheme: "carbon", callbackURL: "/", successURL: "/auth/success" }),
]

// app (React)
import { useBetterAuthTauri } from "@daveyplate/better-auth-tauri/react";

useBetterAuthTauri({
  authClient,
  scheme: "carbon",
  onSuccess: (callbackURL) => navigate({ to: "/workspace" }),
});
```

#### 2-5. UI 変更

- `LoginRoute.tsx` / `SignUpRoute.tsx` → Google ログインボタンのみの画面に置き換え
- `router.tsx` の `fetchMe()` → `authClient.getSession()` に置き換え
- `WorkspaceRoute.tsx` の `handleSignOut` → `authClient.signOut()` に置き換え

#### 2-6. `client.ts` の auth ヘッダ

`request()` の `Authorization` ヘッダ付与も `cachedToken` を参照するように統一:

```ts
// client.ts
import { cachedToken } from "./auth";

// request() 内
if (cachedToken) {
  headers["Authorization"] = `Bearer ${cachedToken}`;
}
```

これにより asset API 等の非認証系リクエストも同じトークンソースを使う。

## 4. 移行チェックリスト

### Phase 1（現リファクタリング）

- [ ] `lib/api/client.ts` に `request()`, `API_BASE_URL`, トークン管理を切り出す
- [ ] `lib/api/index.ts` で barrel export
- [ ] 消費元のインポートパスを更新
- [ ] 旧 `api.ts` を削除
- [ ] 型チェック通過

### Phase 2（Google OAuth）

- [ ] Backend: `socialProviders.google` を追加
- [ ] Backend: `@daveyplate/better-auth-tauri` plugin を追加
- [ ] Backend: 環境変数 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` を設定
- [ ] App: `better-auth` を `app/package.json` に追加
- [ ] App: `@daveyplate/better-auth-tauri` を追加
- [ ] App: `lib/api/auth.ts` に `createAuthClient` + トークンブリッジを実装
- [ ] App: `restoreToken()` をアプリ起動時に呼び出し
- [ ] App: Tauri deep-link plugin を設定（`carbon://` スキーム）
- [ ] App: `LoginRoute` / `SignUpRoute` を Google ログイン UI に置き換え
- [ ] App: `router.tsx` の `fetchMe()` → `authClient.getSession()` に置き換え
- [ ] App: `WorkspaceRoute` の `handleSignOut` → `authClient.signOut()` に置き換え
- [ ] App: `client.ts` の auth ヘッダを `cachedToken` 参照に統一
- [ ] `emailAndPassword` を無効化（移行完了後）

## 5. 注意事項

- `@daveyplate/better-auth-tauri` はまだ若いライブラリのため、導入時に最新の API を確認すること
- `better-auth` のバージョンは backend と app で揃えること
- `LazyStore` ↔ メモリキャッシュの同期は `restoreToken()` 呼び出し前の API リクエストで token が空になるため、起動フローの早い段階で呼ぶこと
