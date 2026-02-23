# Carbon ローカルページリンク設計書（TipTapベストプラクティス調査）

## 1. 目的

Carbon のノート編集体験に「ローカルページリンク（ノート間リンク）」を追加する。

- `[[...]]` からノート候補を選択してリンク挿入できる
- ノートの rename/move 後もリンクが壊れにくい
- Markdown 保存との往復（Rich/Plain 切替、再読み込み）で情報欠落しない
- 既存の TipTap + `marked` + `turndown` 構成に段階導入できる

---

## 2. 前提（現行実装）

- フロントエディタ: TipTap 2.x（`@tiptap/react`, `@tiptap/starter-kit`）
- `StarterKit` には Link 拡張が含まれていないため、内部リンク機能は別途追加が必要
- Markdown I/O: `marked`（MD -> HTML） + `turndown`（HTML -> MD）
- ノート識別子は現在「vault 相対パス」（`NoteContent.id`）中心

---

## 3. 調査結果（一次情報）

### 3.1 Link 拡張で押さえる点

- Link 拡張は `openOnClick`, `enableClickSelection`, `autolink`, `linkOnPaste`, `protocols` などを持つ
- 編集中の誤遷移防止には `openOnClick: false` が有効
- カスタム scheme を扱う場合は `protocols`（および URL 検証ロジック）を明示する

示唆:
- 外部リンクとローカルリンクを同じ `href` 検証に流すと事故りやすい。責務分離が安全。

### 3.2 Suggestion ユーティリティで押さえる点

- `@tiptap/suggestion` は `char`, `pluginKey`, `findSuggestionMatch`, `allow`, `command` 等を持つ
- `char` は単一トリガー前提だが、`findSuggestionMatch` を使って `[[query` のような独自マッチに拡張できる

示唆:
- `[[` を実現するなら、`char: "["` + 独自 `findSuggestionMatch` が実装しやすい。

### 3.3 Mark 拡張で押さえる点

- カスタム Mark は `addAttributes`, `parseHTML`, `renderHTML` で永続属性を管理できる
- ProseMirror の `MarkSpec.inclusive` はリンク系で `false` が推奨（カーソル拡張を抑えるため）

示唆:
- ローカルリンクは Link 拡張の使い回しより、専用 Mark (`localPageLink`) の方が挙動を制御しやすい。

### 3.4 システム更新と Undo/保存

- ProseMirror は transaction metadata を持てる
- `addToHistory: false` を付けた transaction は undo 履歴から除外できる
- TipTap には `setMeta` コマンドがあり、transaction metadata 制御が可能

示唆:
- リンクの「解決状態更新」「表示用属性更新」は `addToHistory: false` + `skipPersistence` 系メタで反映する。

### 3.5 Markdown 拡張（将来）

- TipTap の Markdown 機能では、拡張側に `parseMarkdown`/`renderMarkdown` を持たせる設計が可能

示唆:
- 将来 Markdown パイプラインを TipTap 純正に寄せる場合、`localPageLink` の Markdown 変換を拡張内へ寄せられる。

---

## 4. Carbon 向け推奨方針

本節は 3章の一次情報を踏まえた設計判断（推奨）である。

### 4.1 永続識別子は `noteId`（パスは参照情報）

- リンクの本体は不変 ID（`noteId`）を使う
- パス rename/move は頻発するため、パス直参照を主キーにしない

推奨実装:
- 各 Markdown に frontmatter `id` を持たせる（未設定時は初回スキャン時に採番）
- インデックスは `noteId -> { path, title }` で解決する

### 4.2 Markdown 永続形式は標準リンク + カスタム scheme

- 推奨保存形式: `[表示テキスト](carbon://note/<noteId>)`
- 章リンクは必要時のみ: `[表示テキスト](carbon://note/<noteId>#<heading-slug>)`

理由:
- 既存 `marked/turndown` と相性が良い
- `[[...]]` 専用構文より相互変換コストが低い
- 既存の `carbon://asset/...` 設計と整合する

### 4.3 TipTap 上は専用 Mark `localPageLink` を使う

- 外部 URL は通常 Link 拡張（必要なら追加）
- ローカルページリンクは `localPageLink` で独立管理

推奨 attributes:
- `noteId: string`（永続）
- `href: string`（`carbon://note/<noteId>`、永続）
- `resolved: boolean`（描画時のみ。非永続でも可）
- `titleSnapshot?: string`（任意。UI用途）

### 4.4 編集体験

- 入力トリガーは `[[`（Suggestion）
- 編集中の誤遷移を防ぐ（通常 click では遷移しない）
- `Cmd/Ctrl + Click` のみ遷移
- 未解決リンクは視覚的に区別（点線/警告色）

---

## 5. 詳細設計

### 5.1 データモデル

追加候補:

```ts
type NoteMeta = {
  noteId: string;     // frontmatter id
  path: string;       // absolute path
  relativePath: string;
  title: string;      // ファイル名ベース
};
```

運用:
- スキャン時に frontmatter `id` を読む
- `id` がないファイルは採番し、frontmatter を追記
- インメモリ辞書を維持:
  - `byId: Map<string, NoteMeta>`
  - `byPath: Map<string, NoteMeta>`

### 5.2 TipTap 拡張

`localPageLink` Mark の仕様:

- `inclusive: false`
- `exitable: true`（必要に応じて）
- `parseHTML`: `a[href^="carbon://note/"]` を拾う
- `renderHTML`: `<a data-note-id="..." href="carbon://note/...">...</a>`
- コマンド:
  - `setLocalPageLink({ noteId, href })`
  - `unsetLocalPageLink()`
  - `updateLocalPageLinkAttrs(...)`

### 5.3 Suggestion (`[[...]]`)

- `@tiptap/suggestion` を追加依存として導入
- `findSuggestionMatch` を上書きし、`[[query` を検知
- `command` で選択中の query 範囲をリンク付きテキストに置換

候補表示:
- title 前方一致 + 部分一致
- 最近開いたノートを上位表示（任意）
- Enter で確定、Esc でキャンセル

### 5.4 保存/履歴ポリシー

- ユーザー操作（挿入/削除/編集）は通常履歴に積む
- 自動再解決や見た目属性更新は:
  - `tr.setMeta("addToHistory", false)`
  - `tr.setMeta("skipPersistence", true)`（既存方針に合わせる）

### 5.5 Markdown 変換

`app/src/lib/markdown.ts` 拡張方針:

- HTML -> MD
  - `<a href="carbon://note/...">text</a>` を `[text](carbon://note/...)` として保持
  - `data-note-id` があれば `href` 生成を補助
- MD -> HTML
  - `marked` で通常リンクとして HTML 化
  - エディタロード後に `localPageLink` として解釈

### 5.6 リンク解決フロー

1. ノートスキャンで `noteId -> path/title` を構築  
2. エディタ表示中に `localPageLink.noteId` を辞書で解決  
3. 解決できれば `resolved=true`、できなければ `resolved=false`  
4. `Cmd/Ctrl + Click` で `noteId` からノートを開く  

rename/move 時:
- `noteId` は不変のため本文書換え不要
- インデックス更新だけでリンクは追従

---

## 6. 実装ステップ（推奨）

### Phase 1: 基盤

1. `noteId` 導入（frontmatter 読み書き）
2. ノートインデックスに `byId` を追加
3. `localPageLink` Mark 拡張の最小実装
4. Markdown 変換ルール追加（`carbon://note/` 保持）

### Phase 2: UX

1. `@tiptap/suggestion` 導入
2. `[[...]]` サジェスト UI
3. `Cmd/Ctrl + Click` 遷移
4. 未解決リンクのスタイル実装

### Phase 3: 運用改善

1. リンク整合性チェック（dangling link 検出）
2. 削除時の警告（参照元件数表示）
3. 章リンク（`#slug`）対応

---

## 7. テスト観点

最小必須:

1. Round-trip  
`[A](carbon://note/id1)` -> TipTap -> Markdown で不変

2. rename/move 耐性  
リンク先ファイル rename/move 後も `noteId` 解決で遷移できる

3. 未解決リンク  
リンク先削除時に `resolved=false` になる

4. Suggestion 挿入  
`[[` 入力 -> 候補選択 -> 正しい mark/href が挿入される

5. 履歴汚染防止  
自動解決 transaction が undo stack に積まれない

---

## 8. 影響ファイル（実装時の目安）

- `app/src/components/NoteEditor.tsx`
- `app/src/lib/markdown.ts`
- `app/src/lib/types.ts`
- `app/src/lib/noteIndex.ts`
- `app/src/routes/WorkspaceRoute.tsx`
- （新規）`app/src/lib/localPageLinkExtension.ts`
- （新規）`app/src/lib/noteFrontmatter.ts`

---

## 9. 参考（調査ソース）

一次情報:

- TipTap Link 拡張（ソース）  
  [https://github.com/ueberdosis/tiptap/blob/main/packages/extension-link/src/link.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-link/src/link.ts)
- TipTap Suggestion（ソース）  
  [https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/suggestion.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/suggestion.ts)
- TipTap Mark API  
  [https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/mark](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/mark)
- TipTap `setMeta` command  
  [https://tiptap.dev/docs/editor/api/commands/set-meta](https://tiptap.dev/docs/editor/api/commands/set-meta)
- ProseMirror Guide（transaction metadata / addToHistory）  
  [https://prosemirror.net/docs/guide/](https://prosemirror.net/docs/guide/)
- ProseMirror MarkSpec `inclusive`  
  [https://prosemirror.net/docs/ref/#model.MarkSpec.inclusive](https://prosemirror.net/docs/ref/#model.MarkSpec.inclusive)
- TipTap Markdown 拡張ガイド（将来導入検討）  
  [https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension](https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension)

補足（ローカル実装確認）:

- StarterKit 2.27.2 ソース（Link 非同梱確認）  
  `/Users/kurinokousaku/Workspace/maron/Carbon/node_modules/.pnpm/@tiptap+starter-kit@2.27.2/node_modules/@tiptap/starter-kit/src/starter-kit.ts`

