---
name: codex-system
description: Codex CLIの基本的な使い方と主要フラグのリファレンス。
disable-model-invocation: true
allowed-tools: Bash(codex *), Read
---

# Codex CLI

OpenAI公式のターミナル上で動作するコーディングエージェント。

## 基本的な使い方

```bash
codex "プロンプト"
```

これだけでCodexと対話できる。カレントディレクトリのコードを読み取り、編集・コマンド実行を行う。

```bash
# 例
codex "このリポジトリの構造を教えて"
codex "src/main.tsのエラーハンドリングを修正して"
codex "テストを追加して"
```

## 主要フラグ

| フラグ | 説明 | 例 |
|-------|------|----|
| `-m, --model` | 使用モデルを指定 | `codex -m gpt-5.3-codex "..."` |
| `-a, --approval-mode` | 承認モードを設定 | `codex -a auto-edit "..."` |
| `-q, --quiet` | 出力を抑制 | `codex -q "..."` |
| `--json` | JSON形式で出力 | `codex --json "..."` |
| `-c` | 設定値を上書き | `codex -c model.reasoning_effort=high "..."` |

### 承認モード (`-a`)

| モード | 説明 |
|-------|------|
| `suggest` | ファイル変更・コマンド実行の都度確認を求める (デフォルト) |
| `auto-edit` | ファイル編集は自動、コマンド実行は確認を求める |
| `full-auto` | すべて自動で実行 (サンドボックス内) |
