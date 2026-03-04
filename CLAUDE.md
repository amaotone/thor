# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
bun run dev          # Start dev server (bun --watch)
bun run build        # TypeScript build (tsc → dist/)
bun run check        # Biome lint + format check
bun run check:fix    # Biome auto-fix
bun run typecheck    # Type check only (tsc --noEmit)
bun run test         # Run tests (vitest run)
bun run test:watch   # Test watch mode
bun vitest run tests/settings.test.ts  # Run a single test
```

Docker: `docker compose up thor -d --build`

## Architecture

```
User → Discord → thor (index.ts) → AI CLI → Workspace
```

thor is a wrapper that invokes Claude Code from Discord chat. Designed for single-user use.

### Layer Structure

| Layer | Files | Role |
|-------|-------|------|
| Entry | `index.ts` | Bootstrap, Discord client setup, Brain/Scheduler wiring |
| Discord | `discord-client.ts`, `agent-response.ts`, `slash-commands.ts` | Message routing, streaming response, slash commands |
| Brain | `brain/brain.ts`, `brain/heartbeat.ts`, `brain/triggers.ts` | Priority queue, autonomous heartbeat/triggers |
| Agent | `agent-runner.ts`, `sdk-runner.ts`, `system-prompt.ts` | Agent SDK runner, system prompt construction |
| MCP | `mcp/server.ts`, `mcp/discord-tools.ts`, `mcp/schedule-tools.ts` | MCP tools for Discord and scheduler operations |
| Scheduler | `scheduler.ts`, `schedule-handler.ts`, `scheduler-discord.ts` | Cron/one-shot schedules, slash command handler, Discord bridge |
| Config | `config.ts`, `constants.ts`, `settings.ts` | Environment variables, constants, runtime settings |

### Key Data Flows

- `index.ts` boots Discord client → `discord-client.ts` routes messages via `routeMessage()`
- `agent-response.ts` streams AI responses to Discord with live editing
- `SYSTEM_COMMAND:` in AI output triggers `system-commands.ts` (e.g., restart)
- MCP tools (`discord-tools.ts`, `schedule-tools.ts`) provide Discord/scheduler access to the AI agent
- Scheduler runs periodic tasks with `node-cron` and sends results to channels

## Development Practices

- **TDD (t-wada style)**: Write a failing test first, make it pass with minimal code, then refactor. Red → Green → Refactor cycle.
- **Tidying (Kent Beck style)**: Separate structural changes from behavioral changes. Make tidying commits (rename, extract, reorder) independently from feature/fix commits.
- **Conventional Commits**: Commit and push at appropriate milestones. Use `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, etc. Keep commits small and focused.
- **Language**: Write all commit messages and README content in English.

## System Prompts

- `prompts/THOR_COMMANDS.md` — Command spec injected into AI CLI
- `AGENTS.md` — Injected via Claude Code's `--append-system-prompt`
- Auto-loaded files (CLAUDE.md, etc.) are handled by the CLI's built-in functionality
