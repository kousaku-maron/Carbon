---
name: tauri-build
description: Tauriアプリをビルドする。リリースまたはデバッグビルドを選択して実行。
user-invokable: true
---

# Tauri Build

## 手順

### 1. ビルドタイプの選択

AskUserQuestion でユーザーにビルドタイプを選択させる:

- **リリースビルド**: 最適化あり、DevTools無効
- **デバッグビルド**: 最適化なし、DevTools有効

### 2. ビルド実行

選択に応じてコマンドを実行する:

- リリース: `cd app && pnpm tauri:build`
- デバッグ: `cd app && pnpm tauri build --debug`

### 3. 結果報告

ビルドの成功/失敗をユーザーに報告する。

- リリース出力: `app/src-tauri/target/release/bundle/macos/Carbon.app`
- デバッグ出力: `app/src-tauri/target/debug/bundle/macos/Carbon.app`
