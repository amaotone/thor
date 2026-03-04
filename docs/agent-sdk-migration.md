# Agent SDK Migration: Architecture Document

## Executive Summary

thor の AI バックエンドを **Claude CLI のサブプロセス管理** から **Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) のインプロセス呼び出し** へ移行した。
同時に、AI 出力中のテキストコマンド (`!discord send ...`) を正規表現で解析・実行していたフィードバックループを廃止し、**MCP (Model Context Protocol) Tools** として再実装した。

### Before / After

| 観点 | Before | After |
|------|--------|-------|
| AI 呼び出し | `child_process.spawn("claude")` で持続プロセスを管理 | `query()` による per-request 関数呼び出し |
| Discord/Schedule 操作 | AI 出力テキストを正規表現パース → 実行 → 結果を再注入 | AI が MCP Tool を直接呼び出し |
| エラー回復 | Circuit breaker, backoff, buffer flush | SDK 側で管理、不要に |
| セッション継続 | stdin/stdout の持続プロセスで実現 | `resume: sessionId` オプション |

---

## Architecture

```
Discord User
    │
    ▼
┌──────────────────────────────────────────────────┐
│  Discord Client (discord.js)                     │
│  message-handler.ts / discord-client.ts          │
└──────────┬───────────────────────────────────────┘
           │ getBrain().runStream(prompt, callbacks)
           ▼
┌──────────────────────────────────────────────────┐
│  Brain (brain.ts)                                │
│  Priority queue + preemption                     │
│  USER(0) > EVENT(1) > HEARTBEAT(2)               │
└──────────┬───────────────────────────────────────┘
           │ runner.runStream(prompt, callbacks)
           ▼
┌──────────────────────────────────────────────────┐
│  SdkRunner (sdk-runner.ts)                       │
│  per-request query() + AbortController           │
│  async generator で SDKMessage をストリーミング処理│
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  MCP Server "thor" (server.ts)             │  │
│  │  ├── discord_send                          │  │
│  │  ├── discord_channels                      │  │
│  │  ├── discord_history                       │  │
│  │  ├── discord_delete                        │  │
│  │  ├── schedule_create                       │  │
│  │  ├── schedule_list                         │  │
│  │  ├── schedule_remove                       │  │
│  │  └── schedule_toggle                       │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
           │
           ▼
   Claude Code (Anthropic API)
```

### Data Flow

1. Discord メッセージ受信 → `message-handler.ts` がプロンプトを構築
2. `Brain.runStream()` が priority queue でスケジューリング（USER メッセージは HEARTBEAT タスクをプリエンプト）
3. `SdkRunner.runStream()` が SDK `query()` を呼び出し、`AsyncGenerator<SDKMessage>` をイテレート
4. AI が Discord 送信やスケジュール操作を行いたい場合、**MCP Tool を直接呼び出す**（テキスト出力を経由しない）
5. ストリーミング中のテキスト delta を `onText` callback 経由で Discord に逐次表示
6. 完了時に `onComplete` で最終テキストを Discord に送信

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Bun | latest | TypeScript 実行、パッケージ管理 |
| AI SDK | `@anthropic-ai/claude-agent-sdk` | ^0.2.66 | Claude Code のプログラマティック呼び出し |
| Chat | `discord.js` | ^14.16.3 | Discord Bot |
| Schema | `zod` | ^4.3.6 | MCP Tool の入力スキーマ定義 |
| Scheduler | `node-cron` | ^4.2.1 | 定期実行タスク |
| Lint | `@biomejs/biome` | 2.4.4 | Linter / Formatter |
| Test | `vitest` | ^4.0.18 | Unit test |
| Type | `typescript` | ^5.7.2 | Static typing |

---

## Key Design Decisions

### 1. Per-request `query()` (持続プロセスではなく)

**選択**: リクエストごとに `query()` を呼び出し、`AsyncGenerator` でメッセージをストリーミング処理。

**理由**:
- Brain の priority queue はタスクをキャンセル・プリエンプトする必要があり、per-request + `AbortController` が最もシンプル
- セッション継続は SDK の `resume: sessionId` オプションで実現できるため、持続プロセスは不要
- プロセスクラッシュ回復（circuit breaker, backoff, buffer management）が完全に不要になる

### 2. In-process MCP Server

**選択**: `createSdkMcpServer()` でインプロセス MCP サーバーを作成し、ツール関数が Discord client / Scheduler を直接参照。

**理由**:
- IPC オーバーヘッドゼロ
- ツール関数は通常の TypeScript 関数として実装でき、テストも容易
- 型安全: `zod/v4` でスキーマを定義し、SDK の `tool()` ヘルパーで型推論が効く

### 3. `RunContext` による channel 情報の受け渡し

**選択**: mutable な `RunContext` オブジェクトを `query()` 呼び出し前に同期的にセットし、MCP Tool 内で参照。

**理由**:
- Brain が実行を直列化しているためレースコンディションは発生しない
- 各ツールが呼び出し元の channelId/guildId を知る必要があるが、MCP プロトコルにはリクエストコンテキストの概念がないため、アプリケーションレベルで注入

### 4. Lazy Brain 初期化

**選択**: `getBrain: () => Brain` パターンで Discord client に lazy accessor を渡す。

**理由**:
- SdkRunner の構築には Discord client（MCP ツール用）と Scheduler が必要
- Discord client のセットアップには Brain への参照が必要
- 循環依存を lazy accessor で解消

### 5. テキストベースコマンドの維持 (`SYSTEM_COMMAND:restart`, `MEDIA:`)

**選択**: プロセス再起動やファイル添付は引き続きテキスト出力で処理。

**理由**:
- `SYSTEM_COMMAND:restart` はプロセス自体の終了を伴うため、ツール呼び出しのレスポンスを返せない
- `MEDIA:` はファイルパスを出力テキストに含める軽量な仕組みで、MCP Tool 化のメリットが薄い

---

## What Was Removed

移行に伴い以下を削除（約 800 行の削減）:

| File | Role |
|------|------|
| `persistent-runner.ts` | `child_process.spawn` によるプロセス管理 |
| `claude-code.ts` | CLI アダプタ（引数構築、パス解決） |
| `feedback-loop.ts` | AI 出力パース → コマンド実行 → 結果再注入 |
| `response-parser.ts` | `!discord` / `!schedule` コマンドの正規表現パーサ |
| 関連テスト 4 ファイル | 上記の単体テスト |

削除されたインフラ:
- Circuit breaker（`CIRCUIT_BREAKER_PREFIX`, `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS`）
- Buffer management（`MAX_BUFFER_SIZE`）
- Process health monitoring（alive/dead 状態管理）
- `handleResponseFeedback()` フィードバックループ

---

## What Was Added

| File | Role |
|------|------|
| `src/mcp/context.ts` | リクエストコンテキスト（channelId, guildId） |
| `src/mcp/discord-tools.ts` | Discord MCP Tools (send, channels, history, delete) |
| `src/mcp/schedule-tools.ts` | Scheduler MCP Tools (create, list, remove, toggle) |
| `src/mcp/server.ts` | MCP サーバーファクトリ |
| `src/agent/sdk-runner.ts` | SDK ベースのランナー |

---

## Verification

| Check | Result |
|-------|--------|
| `bun run typecheck` | Pass (0 errors) |
| `bun run test` | 207 tests passed (18 files) |
| `bun run check` | Pass (Biome lint + format) |
