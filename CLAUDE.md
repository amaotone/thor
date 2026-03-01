# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 開発コマンド

```bash
bun run dev          # 開発サーバー起動（bun --watch）
bun run build        # TypeScriptビルド（tsc → dist/）
bun run check        # Biome lint + format チェック
bun run check:fix    # Biome 自動修正
bun run typecheck    # 型チェックのみ（tsc --noEmit）
bun run test         # テスト実行（vitest run）
bun run test:watch   # テストwatch
bun vitest run tests/sessions.test.ts  # 単一テスト実行
```

Docker起動: `docker compose up thor -d --build`

## アーキテクチャ

```
User → Discord → thor (index.ts) → AI CLI → Workspace
```

thorはDiscordチャットからClaude Codeを呼び出すラッパー。シングルユーザー前提。

### レイヤー構成

| レイヤー | ファイル | 役割 |
|----------|----------|------|
| Chat | `index.ts` | Discordクライアント、メッセージルーティング |
| Agent | `agent-runner.ts`, `base-runner.ts` | AI CLIの抽象インターフェース |
| CLI Adapter | `claude-code.ts` | Claude Codeアダプター実装 |
| Process | `persistent-runner.ts`, `runner-manager.ts`, `process-manager.ts` | 常駐プロセス管理、キュー、サーキットブレーカー |
| Scheduler | `scheduler.ts`, `schedule-cli.ts` | cron/一回限りスケジュール、JSON永続化 |
| Skills | `skills.ts` | `workspace/skills/` からスキル読み込み |
| Config | `config.ts`, `constants.ts`, `settings.ts`, `sessions.ts` | 環境変数、定数、ランタイム設定、セッション管理 |

### 主要なデータフロー

- `index.ts` がDiscordメッセージを受信 → `processPrompt()` でAI CLIに転送
- AI出力中の `!discord` / `!schedule` / `SYSTEM_COMMAND:` を検出して自律実行
- `persistent-runner.ts` は `--input-format=stream-json` でClaude Codeを常駐プロセスとして管理
- スケジューラーは `node-cron` で定期実行、結果をチャンネルに送信

## コード規約

- TypeScript strict mode、ES2022、ESM（NodeNext）
- **Biome** でlint + format（`biome.json` 参照）
  - セミコロンあり、シングルクォート、trailingComma: es5、100文字幅
  - unused variables/imports: error
  - `noExplicitAny`: warn
- pre-commitフック: lefthook + lint-staged でBiome自動修正

## システムプロンプト

- `prompts/THOR_COMMANDS.md` — AI CLIに注入するコマンド仕様
- `AGENTS.md` — Claude Codeの `--append-system-prompt` で注入
- Claude Codeの自動読み込みファイル（CLAUDE.md等）はCLI側の機能に委譲
