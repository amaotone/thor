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
bun vitest run tests/sessions.test.ts  # Run a single test
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
| Chat | `index.ts` | Discord client, message routing |
| Agent | `agent-runner.ts`, `base-runner.ts` | Abstract interface for AI CLI |
| CLI Adapter | `claude-code.ts` | Claude Code adapter implementation |
| Process | `persistent-runner.ts`, `runner-manager.ts`, `process-manager.ts` | Persistent process management, queue, circuit breaker |
| Scheduler | `scheduler.ts`, `schedule-cli.ts` | Cron/one-shot schedules, JSON persistence |
| Skills | `skills.ts` | Load skills from `workspace/skills/` |
| Config | `config.ts`, `constants.ts`, `settings.ts`, `sessions.ts` | Environment variables, constants, runtime settings, session management |

### Key Data Flows

- `index.ts` receives Discord messages → forwards to AI CLI via `processPrompt()`
- Detects `!discord` / `!schedule` / `SYSTEM_COMMAND:` in AI output and executes autonomously
- `persistent-runner.ts` manages Claude Code as a persistent process via `--input-format=stream-json`
- Scheduler runs periodic tasks via `node-cron` and sends results to channels

## System Prompts

- `prompts/THOR_COMMANDS.md` — Command spec injected into AI CLI
- `AGENTS.md` — Injected via Claude Code's `--append-system-prompt`
- Auto-loaded files (CLAUDE.md, etc.) are delegated to the CLI's built-in functionality
