# リファクタリング実行プラン

## 1. 目的

このドキュメントは、現行コードベースのリファクタリングを「すぐ着手できる単位」に整理するための実行メモです。  
詳細設計は各タスク着手時に詰める前提で、ここでは優先度と作業境界を明確にします。

## 2. 優先実行順

1. WorkspaceRoute 分割
2. assets/resolve 一括取得化 + API クライアント統合
3. 監視時の全走査削減

### 進捗メモ

- P1-1 は 2026-02-25 に実装反映済み（`startsWith` 判定を `isPathInside` に置換）
- WorkspaceRoute 分割は 2026-02-25 に実装反映済み（3-hook アーキテクチャ）
- 監視時の全走査削減は 2026-02-25 に実装反映済み（インクリメンタルツリー更新）

---

## 3. P1-1 削除判定修正

### 目的

パス前方一致による誤判定を解消し、意図しないノートクローズを防ぐ。

### 実施状況

- 対応済み
- 変更内容: 削除時のアクティブノート判定を `startsWith` から `isPathInside` に変更
- 変更ファイル: `app/src/routes/WorkspaceRoute.tsx`

### タスク

- 最低限の回帰テストケースを追加する

### 完了条件

- `/vault/a` 削除時に `/vault/ab.md` が影響を受けない
- フォルダ削除時のみ配下ノートがクローズされる

### 主対象ファイル

- `app/src/routes/WorkspaceRoute.tsx`
- `app/src/lib/pathUtils.ts`

---

## 4. WorkspaceRoute 分割（`useVault` / `useFileWatcher` / `useFileOps`）

### 目的

責務集中を解消し、変更影響範囲を局所化する。

### 実施状況

- 対応済み（2026-02-25）

### 設計概要

WorkspaceRoute（元 485 行 → 約 160 行）を 3 hook に分割し、WorkspaceRoute を薄い UI レイヤーにした。

hook 配置: `app/src/lib/vault/hooks/`

#### `useVault(options?)` — 中央状態管理オーケストレーター

| 項目 | 内容 |
|------|------|
| 状態 | `vaultPath`, `vaultHistory`, `tree`, `activeNote`, `loading` |
| 関数 | `switchVault(path)`, `handleRemoveFromHistory(path)`, `scan(path)` |
| 戻り値 | 上記状態 + 関数 + `useFileOps` のハンドラ全て（スプレッド） |

- すべての `useState` を一元管理し、`setTree` / `setActiveNote` をサブ hook に注入
- マウント時に vault 永続化復元 + `scan` を実行
- `switchVault` は `setActiveNote(null)` + 永続化 + `scan` のフルフロー

```ts
// WorkspaceRoute での使用
const { vaultPath, tree, activeNote, switchVault, handleSelectNote, ... } = useVault({
  onError: setMessage,
});
```

#### `useFileWatcher({ vaultPath, setTree, onFileChange?, onError? })` — ファイル監視

- watch/unwatch ライフサイクルを `useEffect` で管理（`vaultPath` 変更時に自動再接続）
- `WatchEvent` のタイプ別にインクリメンタルツリー更新:
  - `create` → `addToTree`
  - `remove` → `removeFromTree`
  - `rename.from` → `removeFromTree` / `rename.to` → `addToTree`
  - `modify.data` → `onFileChange` callback のみ（ツリー変更なし）
  - `modify.metadata` → 無視（2026-03-01 反映、誤検知抑制）
  - 不明イベント → 無視（false positive 抑制）
- 状態を持たない純粋な副作用 hook（戻り値なし）

#### `useFileOps({ vaultPath, tree, setTree, onSelectNote?, onPathsRemoved?, onPathsMoved?, onError? })` — ファイル CRUD

| 項目 | 内容 |
|------|------|
| 関数 | `handleSaveNote`, `handleCreateFile`, `handleCreateFolder`, `handleRename`, `handleDelete`, `handleMove`, `handleNavigateToNote` |
| ユーティリティ | `validateNodeName`（モジュールレベル純粋関数） |

- 状態を持たない — `setTree` と各種 callback は外部から注入
- ファイル操作後のツリー更新はインクリメンタル:
  - create → `addToTree`、delete → `removeFromTree`、rename/move → `relocateInTree`

#### WorkspaceRoute（残留）

- 状態: `message`, `sidebarOpen`（UI 固有のみ）
- `handleVaultSwitch(path)`: message クリア + `switchVault(path)`
- `handleBrowse()`, `handleSignOut()`

### ファイル構成

```
app/src/lib/vault/
  index.ts                    # barrel exports
  modules/
    store.ts                  # vault 永続化・履歴管理
    note-index.ts             # scanVault, addToTree, removeFromTree, relocateInTree
  hooks/
    use-vault.ts              # オーケストレーター
    use-file-watcher.ts       # ファイル監視
    use-file-ops.ts           # ファイル CRUD
```

### 動作確認チェックリスト

- [ ] アプリ起動 → 前回の vault が復元されツリーが表示される
- [ ] vault 切替 → ツリーが新 vault の内容に更新、activeNote がクリアされる
- [ ] 「Browse」でフォルダ選択 → vault 切替と同じ動作
- [ ] 履歴から vault 削除 → 履歴一覧が更新される
- [ ] ファイル作成 → ツリーに表示される
- [ ] フォルダ作成 → ツリーに表示される
- [ ] リネーム → ツリー更新、開いているノートのパスも追従
- [ ] 削除 → ツリー更新、開いているノートが対象なら閉じる
- [ ] ドラッグ&ドロップで移動 → ツリー更新、パス追従
- [ ] ノート保存 → ディスクに書き込まれる
- [ ] 外部からファイル変更 → watcher が検知しツリー更新
- [ ] Cmd+クリックでリンク遷移 → 対象ノートが開く
- [ ] サインアウト → ログイン画面へ遷移

---

## 5. `assets/resolve` 一括取得化 + `api`/`asset-client` 統合

### 目的

API 呼び出しと DB クエリの効率を上げ、重複した HTTP クライアント実装を統一する。

### タスク

- `assets/resolve` の DB 取得を一括化する
- 返却整形は現行フォーマットを維持する
- `app/src/lib/api.ts` と `asset-client.ts` の共通化方針を決める
- 認証ヘッダ・timeout・エラー処理の実装を一本化する

### 完了条件

- resolve のクエリ回数が入力件数に比例しない
- HTTP クライアント重複が解消される

### 主対象ファイル

- `backend/src/assets.ts`
- `app/src/lib/api.ts`
- `app/src/lib/tiptap/carbon-image-extension/asset-client.ts`

---

## 6. 監視時の全走査削減（増分更新）

### 目的

ファイル監視イベント発生時の全 vault 再走査を減らし、体感レスポンスを安定化する。

### 実施状況

- 対応済み（2026-02-25）
- 方針 B（増分更新）を採用

### 実装内容

- `WatchEvent` のタイプ別にインクリメンタルツリー更新を実装（`use-file-watcher.ts`）
- `note-index.ts` に `addToTree` / `removeFromTree` / `relocateInTree` を追加
- ファイル CRUD 操作後のツリー更新も `scan()` 全スキャンから `addToTree` / `removeFromTree` / `relocateInTree` に置換
- `modify.metadata` は変更通知対象から除外（2026-03-01）

### 主対象ファイル

- `app/src/lib/vault/hooks/use-file-watcher.ts`
- `app/src/lib/vault/hooks/use-file-ops.ts`
- `app/src/lib/vault/modules/note-index.ts`

---

## 7. 進行管理メモ

- 各セクションは独立 PR に分ける
- P1 完了までは機能追加より安定化を優先する
- 既存 docs と重複する詳細仕様は増やさず、差分だけ追記する
