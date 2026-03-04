<img width="240" height="240" alt="thor" src="docs/images/thor.png" />

# thor

thor is a personal AI assistant for Discord, powered by the Claude Agent SDK.
Designed for single-user use.

## Features

- **Chat** — Talk to Claude directly in Discord. Responses stream in real time with tool progress visibility.
- **Persistent sessions** — Conversation context is retained per channel. Use `/new` to reset.
- **Brain** — Priority-based task queue. User messages automatically preempt lower-priority tasks (heartbeat, triggers).
- **Autonomous heartbeat** — Periodically checks a `HEARTBEAT.md` checklist in the workspace and acts on pending items. Stays silent when there's nothing to do.
- **Event triggers** — Time-based triggers (morning, evening, weekly reflection) that fire prompts automatically.
- **MCP tools** — The agent can interact with Discord (send messages, read history, list channels) and manage schedules through MCP tools.
- **Scheduler** — Set one-time or recurring tasks with natural language (`in 30 minutes`, `every day 9:00`, cron expressions, etc.).
- **Personality** — Customize the agent's personality and user context via `SOUL.md` and `USER.md` in the workspace.
- **File sending** — thor can send files (images, PDFs, etc.) back to Discord via `MEDIA:/path/to/file`.

## Architecture

```
Discord messages
    ↓
Brain (priority queue)
    ├── USER     — chat messages (highest priority, preempts others)
    ├── EVENT    — scheduled triggers
    └── HEARTBEAT — autonomous heartbeat (lowest priority)
    ↓
Agent SDK (sdk-runner.ts)
    ↓
MCP Server
    ├── Discord tools (send, channels, history, delete)
    └── Schedule tools (create, list, remove, toggle)
```

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
  - Required intents: `Message Content`, `Server Members`

## Setup

1. Configure environment variables

```bash
cp .env.example .env
```

Set the following in `.env`:

```bash
WORKSPACE_PATH=./workspace
DISCORD_TOKEN=your_discord_bot_token
DISCORD_ALLOWED_USER=123456789012345678
```

2. Build the image and log in to Claude Code (first time only)

```bash
docker compose build thor
docker compose run --rm thor claude
```

Follow the browser authentication prompt. Credentials are stored in a Docker volume (`claude-data`), so you won't need to log in again after recreating the container.

3. Start the bot

```bash
docker compose up thor -d
```

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `WORKSPACE_PATH` | Path to the workspace directory |
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_ALLOWED_USER` | Your Discord user ID (single user only) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_REPLY_CHANNELS` | — | Comma-separated channel IDs for auto-reply |
| `AGENT_MODEL` | — | Override the agent model |
| `TIMEOUT_MS` | `300000` | Agent timeout in milliseconds |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `TIMEZONE` | `Asia/Tokyo` | Timezone for schedules and triggers |

### Heartbeat

| Variable | Default | Description |
|----------|---------|-------------|
| `HEARTBEAT_ENABLED` | `false` | Enable autonomous heartbeat |
| `HEARTBEAT_CHANNEL_ID` | — | Channel to send heartbeat results |
| `HEARTBEAT_MIN_INTERVAL_MS` | `1800000` | Minimum interval (30 min) |
| `HEARTBEAT_MAX_INTERVAL_MS` | `7200000` | Maximum interval (2 hours) |
| `HEARTBEAT_IDLE_THRESHOLD_MS` | `600000` | Skip if user active within this time (10 min) |

### Triggers

| Variable | Default | Description |
|----------|---------|-------------|
| `TRIGGER_ENABLED` | `false` | Enable event triggers |
| `TRIGGER_CHANNEL_ID` | — | Channel to send trigger results |
| `TRIGGER_MORNING_HOUR` | `8` | Morning trigger hour |
| `TRIGGER_EVENING_HOUR` | `22` | Evening trigger hour |
| `TRIGGER_WEEKLY_DAY` | `0` | Weekly reflection day (0=Sun … 6=Sat) |

## Workspace Files

Place these files in your `WORKSPACE_PATH` to customize behavior:

| File | Purpose |
|------|---------|
| `USER.md` | User info and preferences (injected into system prompt) |
| `SOUL.md` | Personality and values (injected into system prompt) |
| `HEARTBEAT.md` | Checklist for autonomous heartbeat |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a new session |
| `/stop` | Stop the running task |
| `/status` | Show brain status (busy, queue length, session) |
| `/schedule add` | Add a schedule |
| `/schedule list` | List all schedules |
| `/schedule remove` | Remove a schedule |
| `/schedule toggle` | Enable/disable a schedule |

## Inspired by

- [xangi](https://github.com/karaage0703/xangi) by [@karaage0703](https://github.com/karaage0703)

## License

MIT
