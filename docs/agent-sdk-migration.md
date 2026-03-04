# Agent SDK Migration: Architecture Document

## Executive Summary

thor の AI バックエンドは2段階の移行を経ている:

1. **CLI → Agent SDK** (初回移行): `child_process.spawn("claude")` + テキストコマンドパース → Agent SDK `query()` + MCP Tools
2. **Agent SDK → CLI subprocess** (本移行): Agent SDK `query()` → `claude -p --output-format stream-json` + HTTP MCP Server

### 本移行の理由

Anthropic が 2026年2月に ToS を明確化し、OAuth トークン（Free/Pro/Max）を Agent SDK で使うことを明示的に禁止した。
thor は Agent SDK の `query()` を OAuth 認証で使用しており、違反状態にあった。
`claude -p`（CLI 直接呼び出し）は OAuth 認証で許可されているため、CLI サブプロセス方式に移行した。

### Before / After (本移行)

| 観点 | Before (Agent SDK) | After (CLI subprocess) |
|------|--------|-------|
| AI 呼び出し | `query()` による per-request 関数呼び出し | `spawn("claude", ["-p", ...])` で NDJSON ストリーミング |
| MCP 接続 | In-process `createSdkMcpServer()` | HTTP MCP サーバー (`--mcp-config`) |
| セッション継続 | `resume: sessionId` オプション | `--resume sessionId` CLI フラグ |
| キャンセル | `AbortController.abort()` | `process.kill('SIGTERM')` |
| システムプロンプト | `systemPrompt.append` | `--append-system-prompt-file` |

---

## Architecture

```
Discord User
    │
    ▼
┌──────────────────────────────────────────────────┐
│  Discord Client (discord.js)                     │
│  discord-client.ts / agent-response.ts           │
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
│  CliRunner (cli-runner.ts)                       │
│  per-request spawn("claude", ["-p", ...])        │
│  NDJSON stdout パースでストリーミング処理          │
│                                                  │
│       ↕ HTTP (--mcp-config)                      │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  HTTP MCP Server (http-server.ts)          │  │
│  │  ├── discord_post                          │  │
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
   Claude Code CLI (OAuth)
```

### Data Flow

1. Discord メッセージ受信 → `discord-client.ts` がプロンプトを構築
2. `Brain.runStream()` が priority queue でスケジューリング（USER メッセージは HEARTBEAT タスクをプリエンプト）
3. `CliRunner.runStream()` が `claude -p --output-format stream-json` を spawn し、stdout の NDJSON をパース
4. AI が Discord 送信やスケジュール操作を行いたい場合、HTTP MCP Server 経由で **MCP Tool を呼び出す**
5. ストリーミング中のテキスト delta を `onText` callback 経由で Discord に逐次表示
6. 完了時に `onComplete` で最終テキストを Discord に送信

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | Bun | latest | TypeScript 実行、パッケージ管理 |
| MCP SDK | `@modelcontextprotocol/sdk` | ^1.27.1 | HTTP MCP サーバー |
| Chat | `discord.js` | ^14.16.3 | Discord Bot |
| Schema | `zod` | ^4.3.6 | MCP Tool の入力スキーマ定義 |
| Scheduler | `node-cron` | ^4.2.1 | 定期実行タスク |
| Lint | `@biomejs/biome` | 2.4.4 | Linter / Formatter |
| Test | `vitest` | ^4.0.18 | Unit test |
| Type | `typescript` | ^5.7.2 | Static typing |

---

## Key Design Decisions

### 1. Per-request `spawn()` (持続プロセスではなく)

**選択**: リクエストごとに `claude -p` を spawn し、stdout の NDJSON をパースしてストリーミング処理。

**理由**:
- Brain の priority queue はタスクをキャンセル・プリエンプトする必要があり、per-request + `SIGTERM` が最もシンプル
- セッション継続は `--resume sessionId` で実現できるため、持続プロセスは不要
- CLI の `--output-format stream-json` は SDK の `SDKMessage` と同じ構造を出力するため、パースロジックをほぼ流用可能

### 2. HTTP MCP Server (in-process)

**選択**: Thor プロセス内で HTTP MCP サーバーを起動し、CLI に `--mcp-config` で URL を渡す。

**理由**:
- MCP ツールは Thor プロセス内で実行されるため、Discord client や Scheduler に直接アクセス可能
- `@modelcontextprotocol/sdk` の `McpServer` + `StreamableHTTPServerTransport` で標準的な MCP HTTP サーバーを構築
- `--strict-mcp-config` で他の MCP 設定を無効化し、thor ツールのみを公開

### 3. `ToolDefinition` インターフェース

**選択**: Agent SDK の `tool()` ヘルパーから独立した `ToolDefinition` インターフェースを導入。

**理由**:
- MCP SDK の `registerTool()` と Agent SDK の `tool()` は異なる API
- 共通の `ToolDefinition` を定義することで、ツール実装をトランスポート層から分離
- テストでは直接 `handler()` を呼び出すだけでよく、mock が不要

### 4. `RunContext` による channel 情報の受け渡し

**選択**: mutable な `RunContext` オブジェクトを `runStream()` 呼び出し前に同期的にセットし、MCP Tool 内で参照。

**理由**:
- Brain が実行を直列化しているためレースコンディションは発生しない
- 各ツールが呼び出し元の channelId/guildId を知る必要があるが、MCP プロトコルにはリクエストコンテキストの概念がないため、アプリケーションレベルで注入

### 5. Lazy Brain 初期化

**選択**: `getBrain: () => Brain` パターンで Discord client に lazy accessor を渡す。

**理由**:
- CliRunner の構築には MCP サーバー URL が必要 → MCP サーバーには Discord client が必要
- Discord client のセットアップには Brain への参照が必要
- 循環依存を lazy accessor で解消

---

## Migration Details (Agent SDK → CLI)

### Removed

| File | Role |
|------|------|
| `src/agent/sdk-runner.ts` | Agent SDK ベースのランナー |
| `tests/sdk-runner.test.ts` | SDK ランナーのテスト |
| `@anthropic-ai/claude-agent-sdk` | Agent SDK パッケージ |

### Added

| File | Role |
|------|------|
| `src/agent/cli-runner.ts` | CLI サブプロセスランナー |
| `src/mcp/http-server.ts` | HTTP MCP サーバー |
| `tests/cli-runner.test.ts` | CLI ランナーのテスト |
| `tests/mcp-http-server.test.ts` | HTTP MCP サーバーのテスト |

### Modified

| File | Change |
|------|--------|
| `src/mcp/context.ts` | `ToolDefinition`, `McpToolResult` インターフェース追加 |
| `src/mcp/discord-tools.ts` | `tool()` → `ToolDefinition` 形式 |
| `src/mcp/schedule-tools.ts` | `tool()` → `ToolDefinition` 形式 |
| `src/mcp/server.ts` | `createThorMcpServer()` → `startThorMcpServer()` (async, HTTP) |
| `src/agent/system-prompt.ts` | `buildCliSystemPrompt()` 追加 |
| `src/index.ts` | `SdkRunner` → `CliRunner`, MCP サーバー起動 |

---

## Verification

| Check | Result |
|-------|--------|
| `bun run typecheck` | Pass (0 errors) |
| `bun run test` | 194 tests passed (22 files) |
| `bun run check` | Pass (Biome lint + format) |
