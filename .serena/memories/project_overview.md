# Thor - Project Overview

## Purpose
Thor is a personal AI assistant that bridges Discord and Claude Code (Agent SDK). It receives messages from Discord, runs them through Claude's Agent SDK, and streams responses back. Designed for single-user use.

## Tech Stack
- **Runtime**: Bun (TypeScript)
- **Language**: TypeScript (ES2022, NodeNext modules, strict mode)
- **AI**: `@anthropic-ai/claude-agent-sdk` (Agent SDK)
- **Chat Platform**: `discord.js` v14
- **MCP**: `@modelcontextprotocol/sdk` for tool exposure
- **Scheduler**: `node-cron` for cron/one-shot tasks
- **Validation**: `zod` v4
- **Logging**: `consola`
- **Linting/Formatting**: Biome 2.4
- **Testing**: Vitest 4
- **Git Hooks**: Lefthook + lint-staged

## Architecture
```
User → Discord → thor (index.ts) → Agent SDK → Workspace
```

### Layers
| Layer | Directory | Key Files |
|-------|-----------|-----------|
| Entry | `src/` | `index.ts` |
| Discord | `src/discord/` | `discord-client.ts`, `agent-response.ts`, `slash-commands.ts`, `channel-utils.ts`, `message-enrichment.ts`, `schedule-send.ts` |
| Brain | `src/brain/` | `brain.ts`, `heartbeat.ts`, `triggers.ts` |
| Agent | `src/agent/` | `agent-runner.ts`, `sdk-runner.ts`, `system-prompt.ts` |
| MCP | `src/mcp/` | `server.ts`, `discord-tools.ts`, `schedule-tools.ts`, `context.ts`, `http-server.ts` |
| Scheduler | `src/scheduler/` | `scheduler.ts`, `schedule-handler.ts`, `scheduler-discord.ts`, `schedule-cli.ts`, `schedule-formatter.ts`, `schedule-parser.ts` |
| Config/Lib | `src/lib/` | `config.ts`, `constants.ts`, `settings.ts`, `error-utils.ts`, `message-utils.ts`, `system-commands.ts`, `logger.ts`, `file-utils.ts` |

### Key Data Flows
- `index.ts` boots Discord client → `discord-client.ts` routes messages via `routeMessage()`
- `agent-response.ts` streams AI responses to Discord with live editing
- `SYSTEM_COMMAND:` in AI output triggers `system-commands.ts`
- MCP tools provide Discord/scheduler access to the AI agent
- Scheduler runs periodic tasks with `node-cron`

## Environment Variables
See `.env.example` for full list. Key vars:
- `DISCORD_TOKEN`, `DISCORD_ALLOWED_USER` (required)
- `WORKSPACE_PATH` (default: `./workspace`)
- `AGENT_MODEL`, `TIMEOUT_MS`, `LOG_LEVEL`, `TIMEZONE`
- Heartbeat config: `HEARTBEAT_ENABLED`, `HEARTBEAT_CHANNEL_ID`, intervals
- Trigger config: `TRIGGER_ENABLED`, `TRIGGER_CHANNEL_ID`, hours/day
