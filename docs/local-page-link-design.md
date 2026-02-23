# Carbon ローカルページリンク設計書（相対パスMarkdown方針）

## 1. 目的

Carbon のローカルページリンク機能を、Markdown ファイルの可読性と互換性を優先して設計する。

- 保存形式は標準 Markdown リンクのみを使う
- `frontmatter` や専用 ID への依存を避ける
- `[[...]]` は入力補助として提供し、保存時は通常リンクへ正規化する
- rename/move によるリンク破損は許容する

---

## 2. 前提（現行実装）

- エディタ: TipTap 2.x（`@tiptap/react`, `@tiptap/starter-kit`）
- Markdown I/O: `marked`（MD -> HTML） + `turndown`（HTML -> MD）
- `StarterKit` には Link 拡張が含まれていないため、リンク挙動は別途構成が必要
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

### 3.3 壊れたリンクは許容する

- rename/move でリンクが壊れるのは仕様として受け入れる
- 自動追従は MVP では行わない
- 必要であれば将来「任意実行のリンク再解決ツール」を追加する

### 3.4 本文メタデータは増やさない

- frontmatter は追加しない
- コメントベースの ID も追加しない
- 追加管理情報は本文外（メモリ or アプリ内部キャッシュ）に限定する

---

## 4. TipTap 実装方針

### 4.1 リンク拡張

- `@tiptap/extension-link` を導入
- `openOnClick: false` を設定し、ブラウザ既定遷移には任せない
- 内部リンク（相対パス）はクリックでアプリ側のノート遷移を実行する
- 外部リンク（`http(s)`）は内部リンク遷移の対象外とする

### 4.2 Suggestion（`[[...]]`）

- `@tiptap/suggestion` を導入
- `findSuggestionMatch` を使って `[[query` を検出
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

### 6.1 保存（HTML -> Markdown）

- `turndown` の標準リンク変換を利用
- `<a href="../Private/test.md">test</a>` は `[test](../Private/test.md)` へ変換
- 追加属性（`data-*`）には依存しない

### 6.2 読み込み（Markdown -> HTML）

- `marked` の標準リンク変換を利用
- 相対リンクを特別なスキームへ変換しない

---

## 7. UX 方針

- 表示テキストはデフォルトでノート名（拡張子なし）
- Shift+Enter などのショートカットで挿入確定（任意）
- 内部リンクはクリックでページを開く
- リンク切れは薄い警告スタイル（例: 点線下線）で表現してもよい
- ただし「自動修復」は行わない

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

## 10. 影響ファイル（実装時の目安）

- `app/src/components/NoteEditor.tsx`
- `app/src/lib/markdown.ts`
- `app/src/lib/pathUtils.ts`
- `app/src/lib/types.ts`
- `app/src/routes/WorkspaceRoute.tsx`
- （新規）`app/src/lib/linkNavigation.ts`（相対リンク解決/検証を分離する場合）

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
