# GitHub Sync Plan

## 1. 背景

Carbon は現在、`notes`/`folders` を DB で管理する構成です。  
「ローカルで Markdown を編集し、GitHub リポジトリへ `push` した内容を正本 DB に反映したい」という要件に対して、GitHub 同期機能を追加する。

この設計では以下を満たす。

- ローカル `git pull/push` を同期手段として利用できる
- GitHub `push` をトリガーに DB へ反映できる
- 将来的に DB -> GitHub の双方向同期へ拡張できる

## 2. 現状整理

- ノート正本: Postgres (`frontend/db/schema/app.ts`)
- ノート更新経路: API (`frontend/src/pages/api/notes/index.ts`, `frontend/src/pages/api/notes/[id].ts`)
- GitHub: 認証用途のみ (`frontend/src/lib/server/auth.ts`)
- 未実装: GitHub Webhook 受信、差分反映、同期状態管理

## 3. 方針

- 短期: **DB を正本**のまま、GitHub を同期ソース/同期先として扱う
- まずは `GitHub push -> DB` を実装して、ローカル編集の反映を成立させる
- 次段で `DB -> GitHub` を追加し、双方向同期を完成させる

理由:

- 既存アプリが DB 中心のため改修範囲が最小
- GitHub-only 正本へ全面移行するより安全
- 段階リリースしやすい

## 4. 対象スコープ

- 対象ファイル: `*.md` のみ
- 対象ブランチ: 1 ブランチ固定（例: `main`）
- 対象ディレクトリ: 設定された `base_path` 配下のみ
- 1 接続 = 1 ユーザー × 1 リポジトリ（MVP）

非スコープ（MVP）:

- バイナリファイル同期
- リポジトリ跨ぎ同期
- 複雑な自動マージ（3-way merge）

## 5. データモデル（追加）

### `sync_connections`

GitHub 接続設定を保持。

- `id` (uuid, pk)
- `user_id` (fk -> user.id)
- `provider` (`github`)
- `repo_owner`
- `repo_name`
- `branch`
- `base_path`
- `installation_id` (GitHub App 利用時)
- `status` (`active`/`paused`)
- `created_at`, `updated_at`, `last_synced_at`

### `note_sync_state`

ノートと GitHub ファイルの対応状態を保持。

- `id` (uuid, pk)
- `connection_id` (fk)
- `note_id` (fk -> notes.id)
- `file_path`
- `last_content_hash`
- `last_repo_commit_sha`
- `last_db_updated_at`
- `created_at`, `updated_at`

### `sync_events`

監査/障害調査用ログ。

- `id` (uuid, pk)
- `connection_id` (fk)
- `direction` (`pull`/`push`)
- `event_type` (`upsert`/`delete`/`conflict`/`skip`)
- `note_id` (nullable)
- `file_path` (nullable)
- `commit_sha` (nullable)
- `status` (`done`/`error`/`conflict`)
- `error_message` (nullable)
- `created_at`

## 6. Markdown 形式

ファイル先頭に frontmatter メタ情報を持たせる（推奨）。

```md
---
carbon_note_id: "uuid"
carbon_updated_at: "2026-02-18T12:34:56.000Z"
carbon_content_hash: "sha256:..."
---

# Title
...
```

目的:

- パス変更/リネーム時でも同一ノートを特定しやすくする
- 競合判定を安定させる

## 7. 同期フロー

### 7.1 GitHub -> DB（MVP の必須）

1. GitHub `push` webhook を Worker で受信
2. 署名検証（`X-Hub-Signature-256`）
3. 対象 `repo/branch/base_path` のみ処理
4. 変更ファイル一覧（追加/更新/削除）を取得
5. `*.md` のみ抽出
6. ファイルごとに DB へ `upsert` / `delete`
7. `note_sync_state` と `sync_events` を更新

Cloudflare Worker では、レスポンスを早く返しつつ `waitUntil` で非同期処理する。

### 7.2 DB -> GitHub（Phase 2）

1. ノート作成/更新/削除時に同期イベントを生成
2. バックグラウンドで GitHub Contents API を実行
3. commit 作成（更新/削除）
4. 結果を `note_sync_state`/`sync_events` に反映

## 8. 競合ポリシー

MVP は安全側で実装。

- 同一内容（hash一致）: `skip`
- GitHub 側が古い更新: `skip`
- DB 側が古い更新: `apply`
- 双方更新かつ自動解決不能: `conflict` 記録（自動上書きしない）

`conflict` 時の挙動（推奨）:

- DB 本体は保持
- 衝突内容を別ノート（例: `[CONFLICT] ...`）または `sync_events` に退避
- UI で手動解決可能にする

## 9. セキュリティ

- Webhook 署名必須
- GitHub App を推奨（PAT より権限制御しやすい）
- 必要最小権限: `contents:read/write`, `metadata:read`
- シークレットは Wrangler secret で管理
- Webhook エンドポイントはレート制限/リプレイ対策を実装

## 10. API / エンドポイント案

- `POST /api/sync/github/webhook`
  - GitHub webhook 受信
- `POST /api/sync/github/connect`
  - リポジトリ接続設定の保存
- `POST /api/sync/github/disconnect`
  - 接続解除
- `POST /api/sync/github/manual-pull`
  - 手動取り込み
- `POST /api/sync/github/manual-push`
  - 手動書き出し（Phase 2）
- `GET /api/sync/github/status`
  - 同期状態/最終同期時刻/エラー確認

## 11. 環境変数（追加案）

`frontend/.dev.vars.example` に追記する。

- `GITHUB_SYNC_APP_ID`
- `GITHUB_SYNC_APP_PRIVATE_KEY`
- `GITHUB_SYNC_WEBHOOK_SECRET`
- `GITHUB_SYNC_DEFAULT_BRANCH`（任意）

## 12. 実装フェーズ

### Phase 1（最小成立）

- 接続設定テーブル追加
- webhook 受信 + 署名検証
- `push -> DB` の upsert/delete
- 同期ログ可視化（最低限）

完了条件:

- ローカルで編集して GitHub に push すると、数十秒以内に DB へ反映される

### Phase 2（双方向）

- ノート更新時の `DB -> GitHub` 反映
- 手動 sync API
- 競合UI（最低限）

### Phase 3（運用強化）

- 失敗リトライ
- 詳細メトリクス
- 監査ログ拡充

## 13. テスト計画

- 単体
  - 署名検証
  - frontmatter パース
  - 競合判定ロジック
- 結合
  - push payload から DB 反映
  - 削除/リネーム反映
- E2E
  - ローカル編集 -> push -> DB 反映
  - 競合発生時の期待挙動確認

## 14. リスクと対策

- リスク: webhook 再送で重複反映
  - 対策: イベント冪等キー（delivery id + commit sha）
- リスク: 大量変更でタイムアウト
  - 対策: `waitUntil` + 分割処理 + リトライ
- リスク: 意図しない上書き
  - 対策: 安全側 conflict ポリシー（自動破壊更新をしない）

## 15. 補足（今回の会話での結論）

- 「ローカルから GitHub に push したら DB に sync されるか」は、**この設計を実装すれば Yes**
- 現状コードでは未実装のため、現時点では sync されない
