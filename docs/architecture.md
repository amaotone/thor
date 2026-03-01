# Architecture

An overview of thor's architecture and design philosophy.

## Overview

thor is a wrapper that makes Claude Code accessible from a chat platform.

```
User → Discord → thor → AI CLI → Workspace
```

## Layer Structure

| Layer | Role | Implementation |
|-------|------|----------------|
| Chat | User interface | Discord.js |
| thor | AI CLI integration & control | index.ts, agent-runner.ts |
| AI CLI | AI processing | Claude Code |
| Workspace | Files & skills | skills/, AGENTS.md |

## Components

### Entry Point (index.ts)

The main orchestrator. Integrates the following:

- Discord client initialization
- Message reception and routing
- AI CLI invocation
- Scheduler management
- Command processing (`!discord`, `!schedule`, etc.)

### Agent Runner (agent-runner.ts)

An interface that abstracts the AI CLI:

```typescript
interface AgentRunner {
  run(prompt: string, options?: RunOptions): Promise<RunResult>;
  runStream(prompt: string, callbacks: StreamCallbacks, options?: RunOptions): Promise<RunResult>;
}
```

### System Prompt (base-runner.ts)

Manages system prompts that thor injects into the AI CLI:

- **Chat platform info** — Short fixed text indicating that the conversation is happening through Discord
- **THOR_COMMANDS.md** — Loads Discord operation commands, scheduler specs, etc. from `prompts/THOR_COMMANDS.md`

Workspace settings like AGENTS.md / CHARACTER.md / USER.md are handled by each AI CLI's auto-loading feature:

| CLI | Auto-loaded files | Injection method |
|-----|-------------------|------------------|
| Claude Code | `CLAUDE.md` | `--append-system-prompt` (one-time) |

### AI CLI Adapters

| File | Target CLI | Features |
|------|-----------|----------|
| claude-code.ts | Claude Code | Streaming support, session management |
| persistent-runner.ts | Claude Code (persistent) | Persistent process via `--input-format=stream-json`, queue management, circuit breaker |

### Scheduler (scheduler.ts)

Manages periodic execution and reminders:

- `cron`: Periodic execution via cron expressions
- `once`: One-shot reminders (fires once at a specified time)
- Persisted in JSON file (`${THOR_DATA_DIR}/schedules.json`)
- Watches for file changes and auto-reloads (with debounce)
- Timezone follows the server's `TZ` environment variable

### Skills System (skills.ts)

Loads skills from the `skills/` directory in the workspace and registers them as slash commands.

### Constants (constants.ts)

Centralizes constant values used throughout the application.

## Data Flows

### Message Processing Flow

```
1. User sends a message
   ↓
2. Discord client receives it
   ↓
3. Permission check (allowedUsers)
   ↓
4. Special command detection
   - !discord → handleDiscordCommand()
   - !schedule → handleScheduleMessage()
   - /command → Slash command processing
   ↓
5. Forward to AI CLI (processPrompt)
   ↓
6. Response processing
   - Streaming display
   - File attachment extraction
   - SYSTEM_COMMAND detection
   - !discord / !schedule detection & execution
   ↓
7. Reply to user
```

### Schedule Execution Flow

```
1. Cron/timer triggers
   ↓
2. Scheduler.executeSchedule()
   ↓
3. agentRunner(prompt, channelId)
   - Execute prompt via AI CLI
   ↓
4. sender(channelId, result)
   - Send result to channel
   ↓
5. Auto-delete if one-shot
```

## Design Philosophy

### Single-User Design

thor is designed for **a single user**:

- Authentication is a simple ID check via `DISCORD_ALLOWED_USER`
- Sessions are managed per channel
- Multi-tenant features are intentionally omitted

### Autonomous Command Execution

Detects special commands in AI output and executes them automatically:

| Command | Action |
|---------|--------|
| `SYSTEM_COMMAND:restart` | Process restart |
| `!discord send ...` | Send Discord message |
| `!schedule ...` | Schedule operations |

### Persistence Strategy

| Data | Location | Format |
|------|----------|--------|
| Schedules | `${THOR_DATA_DIR}/schedules.json` | JSON |
| Runtime settings | `${WORKSPACE}/settings.json` | JSON |
| Sessions | `${THOR_DATA_DIR}/sessions.json` | JSON (channel ID → session ID) |

## Environment Variables

See [`.env.example`](../.env.example) for the full list of environment variables.

## Docker

See [`docker-compose.yml`](../docker-compose.yml) and the [Setup Guide](setup.md) for Docker configuration details.
