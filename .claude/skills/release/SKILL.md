---
name: release
description: デスクトップアプリのリリース。バージョンタグの作成とプッシュを実行する。
disable-model-invocation: true
allowed-tools: Bash(git *), Read
---

# Release

デスクトップアプリのリリースを実行するスキル。

## バージョン管理ルール

- バージョンは `app/src-tauri/tauri.conf.json` の `version` フィールドで管理する
- タグのフォーマットは `v{version}`（例: version が `0.1.0` なら タグは `v0.1.0`）
- タグは必ず `main` ブランチ上で作成する

## 実行手順

以下のステップを順番に実行すること。各ステップで問題が発生した場合は、即座に停止してユーザーに報告する。

### 1. mainブランチの確認

- 現在のブランチが `main` であることを確認する
- `main` でない場合は、処理を停止してユーザーに警告する。自動的にブランチを切り替えてはいけない
- `main` ブランチの場合、`git pull origin main` で最新の状態にする
- コミットされていない変更がある場合は、停止してユーザーに確認する

### 2. バージョンの読み取り

- `app/src-tauri/tauri.conf.json` の `version` フィールドを読み取る
- タグ名 `v{version}` を決定し、ユーザーに表示する

### 3. タグの重複チェック

- `git tag -l "v{version}"` でローカルにタグが存在しないことを確認する
- `git ls-remote --tags origin "refs/tags/v{version}"` でGitHub上にタグが存在しないことを確認する
- タグがすでに存在する場合は、停止してユーザーに報告する

### 4. 前バージョンのタグ確認

- `git ls-remote --tags origin "refs/tags/v*"` でGitHub上の既存タグ一覧を取得する
- 前のバージョンのタグ（例: 今回が `v0.1.1` なら `v0.1.0`）がGitHub上に存在することを確認する
- 前バージョンのタグが存在しない場合は、停止してユーザーに警告する（バージョンの飛ばしや指定ミスの可能性）

### 5. タグの作成とプッシュ

- ユーザーにタグ `v{version}` を作成してプッシュしてよいか確認する
- 承認を得たら以下を実行:
  - `git tag v{version}`
  - `git push origin v{version}`

### 6. 完了報告

- リリースタグのプッシュが完了したことを報告する
- GitHub Actionsのリリースワークフローが自動的に起動されることを伝える
