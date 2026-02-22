# Carbon 画像ドラッグ&ドロップ貼り付け設計書（Cloudflare R2）

## 1. 目的

Carbon のノート編集体験に、Notion ライクな画像ドラッグ&ドロップ貼り付けを追加する。

- ユーザーが画像ファイルをエディタへ DnD / Paste すると、そのままノートに埋め込まれる
- 画像実体は Cloudflare R2 に保存する
- Notion と同様に「非公開デフォルト」を維持し、恒久公開URLを前提にしない
- 既存のローカル Markdown ワークフロー（`*.md` ファイル）と両立させる

## 2. 現状整理

- フロント: Tauri + React + TipTap（`/app/src/components/NoteEditor.tsx`）
- ノート保存: ローカルファイルへ Markdown 直接保存（`/app/src/lib/notePersistence.ts`）
- Markdown 変換: `marked` + `turndown`（`/app/src/lib/markdown.ts`）
- バックエンド: Cloudflare Workers + Hono + better-auth（Bearer）
- DB: Neon(PostgreSQL) + Drizzle（現状は auth スキーマ中心）

制約:
- `<img src="...">` では Authorization ヘッダを付与できない
- そのため、非公開配信は「短命URL（署名付き）」で解決する必要がある
- ただし署名URLをそのまま Markdown に保存すると期限切れで壊れる

## 3. 設計方針

### 3.1 永続参照と配信用URLを分離する

- Markdown には永続参照のみ保存する  
  例: `![cat](carbon://asset/as_01JXXXX)`
- 画面表示時のみ、`carbon://asset/*` を短命URLへ解決して `<img src>` に適用する
- これにより、Markdown は期限切れしない

### 3.2 R2 は Private Bucket を採用

- バケットは public 化しない
- 配信は Worker 経由の署名URLで制御する
- オブジェクトキーは推測困難なランダム形式で管理する

### 3.3 MVP と拡張を分離

- MVP: 画像圧縮付きアップロード、表示、削除、基本バリデーション
- 拡張: サムネイル、不要画像GC、公開共有

### 3.4 圧縮アップロードを標準とする

- 画像はクライアント側で圧縮してからアップロードする
- 判定基準は「圧縮後バイト数」で統一する
- 圧縮後サイズが上限（例: 5MB）を超える場合はアップロードを拒否する
- 大容量ファイル向け multipart は採用しない

## 4. 全体アーキテクチャ

```text
[Tauri + TipTap]
  1) DnD/Paste image
  2) POST /api/assets (Bearer, multipart/form-data)
  3) returns assetId + assetUri(carbon://asset/{id})
  4) Markdownへ assetUri を保存
  5) 表示時に POST /api/assets/resolve で短命URL取得
        |
        v
[Cloudflare Worker (Hono)]
  - Auth検証
  - MIME/サイズ検証
  - R2 put/get/delete
  - assets メタデータ管理(PostgreSQL)
  - 短命署名URLの発行と検証
        |
        v
[R2 Private Bucket]
  - 画像実体
```

## 5. データモデル（案）

`backend/db/schema/assets.ts` を追加し、`backend/db/schema/index.ts` から export する。

### 5.1 `assets` テーブル

- `id` (text, pk)  
  例: `as_01J...`（ULID/UUID）
- `ownerUserId` (text, not null, index)
- `objectKey` (text, unique, not null)  
  例: `u/{userId}/2026/02/{id}.webp`
- `originalName` (text)
- `mimeType` (text, not null)
- `sizeBytes` (bigint, not null)
- `width` (integer, nullable)
- `height` (integer, nullable)
- `sha256` (text, nullable)
- `notePath` (text, nullable)  
  ローカルvault相対パス（参照追跡の補助）
- `status` (text, not null, default `active`)  
  `active | deleted`
- `createdAt`, `updatedAt`, `deletedAt`

注記:
- 将来、参照追跡を厳密化するなら `asset_refs` テーブルを別途追加する

## 6. API 設計（案）

`backend/src/index.ts` に `/api/assets/*` ルートを追加。

### 6.1 `POST /api/assets`

用途: DnD/Paste 画像のアップロード

- Auth: 必須（Bearer）
- Request: `multipart/form-data`
  - `file`: compressed image binary（クライアント圧縮後）
  - `notePath`: string (optional)
  - `alt`: string (optional)
- Validation:
  - MIME whitelist（MVP）: `image/png`, `image/jpeg`, `image/webp`
  - 圧縮後サイズ上限（MVP）: 5MB（`ASSET_MAX_IMAGE_BYTES=5242880`）
- 動作:
  - `assets.id` 採番
  - `objectKey` 生成（ランダム）
  - `env.ASSET_BUCKET.put(objectKey, stream, { httpMetadata })`
  - `assets` レコード作成
- Response:
  - `assetId`
  - `assetUri` (`carbon://asset/{assetId}`)
  - `width`, `height`（取得できる場合）

### 6.2 `POST /api/assets/resolve`

用途: 画面表示前に assetUri を短命URLへ解決

- Auth: 必須（Bearer）
- Request JSON:
  - `assetIds: string[]`
- 動作:
  - `ownerUserId` 一致を確認
  - 各 asset に対して短命署名URLを生成（例: TTL 5分）
- Response JSON:
  - `items: [{ assetId, url, expiresAt }]`

### 6.3 `GET /api/assets/:assetId/raw?exp=...&sig=...`

用途: `<img src>` 用の実体配信

- Authヘッダ: 不要（署名で認可）
- 動作:
  - `exp` 期限検証
  - `sig` 検証（HMAC-SHA256）
  - `assets` 参照、`status=active` 確認
  - `R2.get(objectKey)` で stream 返却
  - `Cache-Control: private, max-age=60`

### 6.4 `DELETE /api/assets/:assetId`

用途: 画像削除（将来は UI 操作から呼び出し）

- Auth: 必須（Bearer）
- 動作:
  - owner確認
  - R2 delete
  - DB soft delete

## 7. フロント実装設計

### 7.1 TipTap 拡張

- `@tiptap/extension-image` を導入
- `NoteEditor` で `handleDrop` / `handlePaste` を実装し、画像ファイルを検知
- ドロップ直後はローカル `blob:` でプレビュー表示
- 圧縮処理を実行してからアップロードする
  - 目標: `maxCompressedBytes`（例: 5MB）以下
  - 手順:
    1. 画像を decode
    2. 必要に応じてリサイズ（長辺上限を設定、例: 2560px）
    3. `image/webp` または `image/jpeg` で品質を段階的に下げて再エンコード
    4. 上限内に収まった時点で採用
  - 収まらない場合: エラー表示して挿入しない
  - MVPでは静止画のみ対応し、アニメーションGIFは非対応
- アップロード完了後、画像ノード属性を更新:
  - `src`: 短命URL
  - `data-asset-uri`: `carbon://asset/{id}`（永続）

### 7.2 Markdown 変換ルール

`/app/src/lib/markdown.ts` を拡張する。

- HTML -> Markdown（保存時）:
  - `<img data-asset-uri="carbon://asset/...">` を優先し、
    `![alt](carbon://asset/...)` として出力
- Markdown -> HTML（表示時）:
  - `carbon://asset/...` を抽出
  - `/api/assets/resolve` で短命URLを取得
  - 生成HTML内の `img src` に反映

重要:
- 署名URLは保存しない（保存対象は常に `carbon://asset/...`）

### 7.3 API クライアント修正

`/app/src/lib/api.ts` の `request` は現在 `Content-Type: application/json` 固定のため、
`FormData` 時は `Content-Type` を自動設定に委譲する分岐が必要。

## 8. バックエンド実装設計

### 8.1 Worker Binding / Env

`/backend/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "ASSET_BUCKET"
bucket_name = "carbon-assets-private"
```

追加環境変数:
- `ASSET_SIGNING_SECRET`（短命URL署名用）
- `ASSET_MAX_IMAGE_BYTES`（圧縮後上限、例: `5242880`）

`Bindings` 型にも `ASSET_BUCKET` と上記 vars を追加する。

### 8.2 セキュリティ設計

- バケット非公開（public domain を使わない）
- `objectKey` はユーザー入力から直接生成しない
- `notePath` は保存しても認可判断に使わない（ownerUserId を正とする）
- `sig` には `assetId + exp + ownerUserId` を含めた署名を推奨

### 8.3 CORS 設定

画像API追加に伴い `allowMethods` を拡張:
- `GET, POST, DELETE, OPTIONS`

## 9. 運用・性能

### 9.1 キャッシュ方針

- `/resolve` の結果はクライアントで `expiresAt` までメモリキャッシュ
- `raw` は短め `max-age` を設定

### 9.2 障害時挙動

- アップロード失敗: プレースホルダ画像をエラー状態表示し再試行導線を出す
- resolve失敗: 画像枠に再取得ボタンを表示

### 9.3 ガベージコレクション

MVP では即時GCを行わない。  
将来、以下で清掃:
- `deleted` 状態の `assets` を定期ジョブで purge
- 参照切れ検出は `notePath` とノート再走査で段階導入

## 10. 実装フェーズ

### Phase 1（MVP）

- `assets` テーブル追加
- `/api/assets`, `/api/assets/resolve`, `/api/assets/:id/raw`
- TipTap DnD/Paste + クライアント圧縮 + アップロード + `carbon://asset` 保存

### Phase 2（体験改善）

- 進捗UI（%表示）
- 期限切れ時の自動再resolve

### Phase 3（拡張）

- サムネイル生成
- 公開共有用URL（明示機能）

## 11. 受け入れ基準

- DnD/Paste 画像がノートへ挿入できる
- 圧縮後サイズが上限以下の画像のみアップロードされる
- ノート保存後の Markdown には `carbon://asset/...` が保存される
- 画像実体は R2 private bucket に保存される
- 他ユーザーの assetId を指定しても resolve/raw できない
- 署名URL期限切れ後に再resolveで再表示できる

## 12. トレードオフ

- 利点:
  - Notion同様、非公開デフォルト運用が可能
  - Markdownは期限切れしない
  - R2の低コスト配信を活用できる
- 欠点:
  - `carbon://asset` は外部Markdownビューアでそのままは表示されない
  - resolve処理が必要で実装は単純公開URL方式より複雑
  - クライアント圧縮により画質劣化が起きる可能性がある

## 13. 将来の代替案

- Markdown互換性を最優先する場合:
  - 公開URL（長いランダムキー）を直接保存するモードを別途提供
- 画像変換・CDN最適化を強化する場合:
  - Cloudflare Images への移行または併用を検討
