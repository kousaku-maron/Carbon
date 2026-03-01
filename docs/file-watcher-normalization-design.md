# File Watcher Event Normalization Design

## 1. 背景

`useFileWatcher` は `@tauri-apps/plugin-fs` の `watch` イベントを直接分岐してツリー更新している。  
しかし OS / backend / editor 保存方式の差で、同じ操作でもイベント形が揺れるため、外部変更（VSCode での作成・rename 等）の取りこぼしが発生しやすい。

## 1.1 実装ステータス

- 段階1（正規化レイヤーのみ）は実装済み
- 2026-03-01: `modify.metadata` は `onFileChange` 対象から除外済み（誤検知抑制）
- 段階2（キュー処理）は未着手
- キュー処理は別途対応予定

## 2. 目的

- 外部アプリ操作でもサイドバー反映の一貫性を上げる
- `create/remove/rename/modify` の揺れを吸収する
- 実装責務を「正規化 + キュー処理」に限定して複雑化を避ける

## 3. 非目的

- ファイル監視の 100% 配信保証（OS 制約に依存）
- 監視基盤の完全置換（別プロセス化など）

## 4. 方針

`Raw WatchEvent` を直接適用しない。  
`Normalizer` で `CanonicalOp` に変換して適用する。  
まずは段階1として「正規化のみ（キューなし）」で確認し、問題なければ段階2でキュー化する。

```text
watch event
  -> normalize (kind/mode/path を吸収)
  -> apply ops
```

## 5. CanonicalOp

- `upsert-file(path)`
- `upsert-folder(path)`
- `remove(path)`
- `move(from, to)`  // rename/move 統一
- `touch(path)`     // コンテンツ更新通知のみ

適用順序:
1. `remove`
2. `move`
3. `upsert-*`
4. `touch`（UI ツリーは変更しない）

## 6. 正規化ルール

### 6.1 create

- `kind=file` -> `upsert-file`
- `kind=folder` -> `upsert-folder`
- `kind=any/other` -> `probePath(path)` で file/folder/none を判定

### 6.2 remove

- `kind` に依存せず `remove`

### 6.3 modify.rename

- `mode=both` かつ `paths.length >= 2` -> `move(paths[0], paths[1])`
- `mode=from` -> 一時バッファへ保持
- `mode=to` -> 近接する `from` とペアリングできれば `move`、不可なら `probePath(to)` で `upsert-*`
- `mode=any/other` -> `probePath(path)`（存在すれば `upsert-*`、無ければ `remove`）

### 6.4 modify.data / modify.metadata / any / other

- `modify.data` のみ `touch(path)` を発行
- `modify.metadata` は `onFileChange` 誤検知を避けるため無視する
- `modify.any/other` は現状無視する（不明イベントの安全側運用）

## 7. probePath

`stat(path)` を優先して判定し、失敗時は `exists(path)` で存在可否だけ判定する。  
`exists=false` の場合は `remove` 扱い。  
非 `.md` ファイルは `ignore`。

## 8. 段階的導入

### 8.1 段階1（今回）

- 正規化レイヤーのみ導入する
- イベントごとに `apply ops` を即時実行する（キューなし）
- 定期 scan / 自動 rescan / 自動 retry は導入しない

### 8.2 段階2（段階1が安定したら）

- `CanonicalOp` を短時間キューでまとめて適用する
- 同一 path の重複イベントを圧縮し、`setTree` 更新回数を減らす
- 現時点では未実装（別途対応）

## 9. 監視ライフサイクル

- watcher 初期化失敗時はエラー通知のみ行う（自動リトライは導入しない）
- vault 切替時は queue/buffer/timer を破棄して新しい watcher を張り直す

## 10. ログ/観測（dev のみ）

- raw event と normalized ops の件数
- rename pair 成功率（from/to の一致率）

## 11. 受け入れ条件

- VSCode での `new .md / rename / move / delete` が 1 秒以内にサイドバーへ反映
- 既存の `onFileChange`（編集中ノート再読込）が退行しない

## 12. 変更対象

- `app/src/lib/vault/hooks/use-file-watcher.ts`
- 必要に応じて `app/src/lib/vault/modules/note-index.ts`（適用ユーティリティ補助）
