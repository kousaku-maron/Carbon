# Carbon ローカルページリンク設計書（相対パスMarkdown方針）

## 1. 目的

Carbon のローカルページリンク機能を、Markdown ファイルの可読性と互換性を優先して設計する。

- 保存形式は標準 Markdown リンクのみを使う
- `frontmatter` や専用 ID への依存を避ける
- `[[...]]` は入力補助として提供し、保存時は通常リンクへ正規化する
- サイドバーの rename/move 時に、リンク索引を使って参照先を自動更新する

---

## 2. 前提（現行実装）

- エディタ: TipTap v3（`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`）
- Markdown I/O: `@tiptap/markdown`（エディタ内蔵パース/シリアライズ）
- リンク拡張: `CarbonLink`（`app/src/lib/tiptap/carbon-link-extension/`）— `@tiptap/extension-link` ベースのカスタム拡張
- ノートはローカル `*.md` ファイルとして保存される

---

## 3. 設計方針

### 3.1 保存形式は相対パスリンク

保存するリンクは Markdown の標準形式に統一する。

- 例: `[テスト](../Private/test.md)`
- 例: `[仕様](./specs/link-design.md#保存形式)`

これにより、以下を満たす。

- Markdown 単体で意味が通る
- 他エディタ/他ツールでも読める
- アプリ固有スキーム（`carbon://...`）に依存しない

### 3.2 `[[...]]` は UI 機能、永続仕様ではない

- 入力中に `[[` で候補検索を開く
- 選択時は「現在ノートからの相対パス」を計算してリンク挿入する
- 保存データには `[[...]]` を残さない

### 3.3 サイドバーの移動・リネームに追従する

- 移動対象を参照するノートと、移動対象内のノートのリンク先を更新する
- ファイル・フォルダ両方に対応し、一緒に移動して相対位置が変わらないリンクは変更しない
- 標準 Markdown のリンク・画像・参照定義を対象に、destination のソース範囲だけを置換する
- ラベル、タイトル、改行、その他の書式は維持する。コード、HTML、frontmatter 内は対象外
- Finder・AI等の外部操作は内容の類似度で移動を推定し、対応が明確な場合にリンク切れをバックグラウンド修復する

### 3.4 本文メタデータは増やさない

- frontmatter は追加しない
- コメントベースの ID も追加しない
- 追加管理情報は本文外（メモリ or アプリ内部キャッシュ）に限定する

---

## 4. TipTap 実装方針

リンク機能は `CarbonLink` 拡張として `app/src/lib/tiptap/carbon-link-extension/` にモジュール化されている。

### 4.1 リンク拡張

- `@tiptap/extension-link` をベースにカスタム拡張 `CarbonLink` を構築
- `openOnClick: true` を設定し、内部/外部リンクを拡張内で振り分け
- 内部リンク（相対パス）は `onOpenInternal` コールバックでアプリ側のノート遷移を実行
- 外部リンク（`http(s)`）は `onOpenExternal` コールバックで処理

### 4.2 Suggestion（`[[...]]`）

- `@tiptap/suggestion` を `CarbonLink` 拡張に統合
- `[[query` を検出し、候補リスト（`note-link-suggestion-list.tsx`）を表示
- 候補選択時に挿入するのは通常リンク（`[title](relative/path.md)`）

### 4.3 マークは標準 Link を使う

- カスタム Mark（`localPageLink`）は作らない
- HTML 上は通常の `<a href="...">` として扱う
- `href` が相対パスなら内部リンク、`http(s)` なら外部リンクとして判定する

---

## 5. 相対パス解決ルール

### 5.1 挿入時

`source = 現在のノート`, `target = 選択されたノート` として相対パスを計算する。

1. source の親ディレクトリを基準にする  
2. target までの相対経路を求める  
3. 区切りは `/` に正規化する  
4. 拡張子 `.md` は保持する  

### 5.2 遷移時

1. リンククリック時に `href` が相対パスなら、現在ノート基準で絶対パスに解決  
2. vault 配下かを検証（パストラバーサル防止）  
3. `.md` ファイルが存在すれば開く  
4. 見つからなければ「リンク先が見つからない」を通知  

### 5.3 セキュリティ

- `javascript:` `data:` は無効化
- vault 外を指す `../` 解決結果は拒否

---

## 6. Markdown 変換ポリシー

### 6.1 保存（TipTap → Markdown）

- `@tiptap/markdown` の標準リンクシリアライズを利用
- `[test](../Private/test.md)` として出力
- 追加属性（`data-*`）には依存しない

### 6.2 読み込み（Markdown → TipTap）

- `@tiptap/markdown` の標準リンクパースを利用
- 相対リンクを特別なスキームへ変換しない

---

## 7. UX 方針

- 表示テキストはデフォルトでノート名（拡張子なし）
- Shift+Enter などのショートカットで挿入確定（任意）
- 内部リンクはクリックでページを開く
- リンク切れは薄い警告スタイル（例: 点線下線）で表現してもよい
- サイドバー操作での自動更新は行うが、すでに壊れたリンクの推測による修復は行わない

---

## 8. 実装ステップ（推奨）

### Phase 1: 基本リンク

1. Link 拡張導入（`openOnClick: false`）
2. クリックで相対リンク遷移
3. vault 外参照を拒否するガード実装

### Phase 2: `[[...]]` 入力補助

1. `@tiptap/suggestion` 導入
2. ノート候補検索 UI
3. 選択時に相対パス Markdown リンクを挿入

### Phase 3: 任意改善

1. リンク切れ検出（表示時チェック）
2. 参照一覧表示（被リンク/発リンク）
3. 手動リンク再解決コマンド（必要なら）

---

## 9. テスト観点

1. Round-trip  
`[A](../B.md)` が Rich/Plain 切替後も不変

2. 相対パス解決  
異なる階層間リンクが正しく計算される

3. 遷移ガード  
vault 外パスは開けない

4. リンク切れ  
存在しない相対パスでエラー通知される

5. Suggestion 挿入  
`[[` から選択後、標準 Markdown リンクとして保存される

---

## 10. 影響ファイル（実績）

- `app/src/components/NoteEditor.tsx` — `CarbonLink` 拡張の利用、コールバック設定
- `app/src/lib/tiptap/carbon-link-extension/` — リンク拡張＋Suggestion の実装
- `app/src/lib/linkUtils.ts` — 相対パス計算・解決・検証ユーティリティ
- `app/src/lib/pathUtils.ts` — パス操作ユーティリティ
- `app/src/lib/types.ts` — 型定義
- `app/src/routes/WorkspaceRoute.tsx` — `onNavigateToNote` ハンドラ

---

## 11. 参考（調査ソース）

- TipTap Link 拡張  
  [https://tiptap.dev/docs/editor/extensions/marks/link](https://tiptap.dev/docs/editor/extensions/marks/link)
- TipTap Suggestion ユーティリティ  
  [https://tiptap.dev/docs/editor/api/utilities/suggestion](https://tiptap.dev/docs/editor/api/utilities/suggestion)
- TipTap Mark 拡張 API  
  [https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/mark](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/mark)
- TipTap `setMeta` command  
  [https://tiptap.dev/docs/editor/api/commands/set-meta](https://tiptap.dev/docs/editor/api/commands/set-meta)
- ProseMirror Guide  
  [https://prosemirror.net/docs/guide/](https://prosemirror.net/docs/guide/)

## 12. リンク索引とファイル操作（実装）

- 保存先: Tauri の `app_data_dir` 内の `link-index-<Vault絶対パスのSHA-256>.json`
  - macOS: `~/Library/Application Support/dev.maron.carbon/`
  - 既存の Tauri Store を使用。SQLite ランタイムの追加は不要
  - Vault 内や `.carbon` には索引を作らない
- 内容: スキーマバージョン、Vault パス、ノートごとの更新時刻・サイズ・参照先（Vault相対パス）、内容比較用の署名とSHA-256、修復用のリンク文字列
- 利用中はメモリ上に逆引き（参照先→参照元）を構築する
- 初回はバックグラウンドで全ノートを解析。再起動時はメタデータを照合し、変更されたノートだけ再解析
- 保存、外部変更、追加・削除、フォルダ追加、外部移動で該当エントリを更新する
- 永続化は500msでまとめる。削除・破損したキャッシュはMarkdownから再構築する
- 通常の移動時はメモリ上で対象を抽出し、対象ノートのみ読み書きする。索引が未完成・不整合なら、構築完了を待つ
- 移動前に実行中の保存を待ち、未保存の編集を保存する。外部変更と未保存編集が競合する場合は移動を中止する
- 移動中はUI操作を一時的に止め、古いエディタの遅延保存を無効化する。更新後に表示を読み直す
- 移動先に既存のファイル・フォルダがあれば上書きせず中止する
- 更新直前に本文が変わっていれば上書きせず中止。書き込み失敗時は本文と移動を可能な範囲で復元し、復元にも失敗した場合は明示的にエラーを表示する
- 複数ファイルの操作はファイルシステム全体の原子的トランザクションではない。アプリの強制終了や端末停止をまたぐ復旧ジャーナルは未実装
- ファイル監視が届く前の外部編集やイベント欠落には即時追従を保証できない。次回Vault読み込み時にディスクと再照合する

## 13. 外部移動の推定とバックグラウンド修復

- Gitと同様に、UTF-8の本文を改行または64バイトごとの断片として集計し、共通する断片の推定バイト数を前後の大きい方のファイルサイズで割る。テキストのCRLFではCRを集計から除く
- 完全一致は別途SHA-256で判定する。GitのCコードの移植ではなく、同じ計算方針の独立実装
- Carbonの初期設定: 類似度85%以上、競合候補との差10ポイント以上。削除元・追加先の両方で競合を調べ、一対一で明確な対応のみ採用する
- 空の文書は対象外。完全一致しない80バイト未満の文書も対象外
- 設定値は `content-similarity.ts` に集約。確率を表すものではなく、実際のMarkdown編集例を使って調整するための初期値
- 索引v2では削除前の署名とリンク情報、新規パスを保持する。候補は検知から7日間保持する。v1キャッシュは一度再構築が必要で、それ以前の内容比較情報は復元できない
- 起動時にファイル一覧・メタデータを照合する。本文は追加・変更分だけ解析する。定期照合は行わず、起動中は既存の変更通知を利用する
- 起動中の既存監視イベントでは該当パスの索引を更新し、1秒間の連続イベントをまとめて同じ照合処理を実行する
- 削除候補数×追加候補数が100,000を超える場合は自動比較を保留し、バックグラウンド処理の過大化を防ぐ
- 修復対象は現在存在しないリンク先のみ。AIが修正済みのリンクや、現在有効なリンクは変更しない
- 移動したMarkdown内の相対リンクは、移動前と同じリンク文字列が残り、旧参照先が一意に分かる場合に修正する。複数ファイルの同時移動もパスマッピングを一括適用する
- 処理直前に移動先の更新情報と修正する本文を再確認する。未保存編集や保存処理がある間は修復を延期し、次の照合で再試行する
- 元ファイルが残っているコピーは移動として扱わない。大幅な書き換えや曖昧な対応は自動修復しない
- 外部移動の類似比較対象はMarkdown。外部で移動された画像等のファイル自体の同一性推定は対象外。Carbon内の画像移動の追従は従来どおり
- 索引は比較用キャッシュであり、MarkdownへID・frontmatter・コメントを追加しない

## 14. リンク処理のステータス表示

- 索引の構築・更新・保存中は `Updating link index…`、リンク修復中は `Repairing links…` を表示する
- 表示待ちのタイマーは設けず、処理開始時に表示し、成功・失敗どちらも終了時に消す
- サイドバー下部に控えめなスピナー付きで表示する。サイドバーを閉じた場合や狭い画面では画面下部に表示する
- 前のVaultの処理通知は現在のVaultに表示しない
- ステータスは操作制限されるワークスペースの外側に置き、スクリーンリーダーでも読み上げ可能にする
