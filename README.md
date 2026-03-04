<img width="240" height="240" alt="thor" src="docs/images/thor.png" />

# thor

thor is a personal AI assistant for Discord.
It is designed for single-user operation and runs Claude Code CLI with a priority-aware runtime.

## Features

- **Discord chat assistant** with streaming replies and tool progress updates.
- **Brain queue** with priorities:
  - `USER` (highest)
  - `EVENT`
  - `HEARTBEAT` (lowest)
- **Heartbeat loop** for autonomous background checks (`HEARTBEAT.md`).
- **Scheduler** with natural language parsing (`30分後`, `毎日 9:00`, cron, startup tasks).
- **MCP tools** for Discord, schedules, memory, and Twitter (when enabled).
- **Memory DB** (`bun:sqlite`) for long-term observations, people, and reflections.
- **Workspace-driven behavior** via `USER.md`, `SOUL.md`, `CONTENT_POLICY.md`.
- **File return support** via `MEDIA:/absolute/path/to/file` in model output.

## Architecture

thor is split into 3 layers:

- `core/`: domain logic and shared primitives
- `extensions/`: platform and integration adapters
- `runtime/`: bootstrap/composition root

```text
Discord/Twitter/MCP (extensions)
          ↓
     runtime/bootstrap
          ↓
         core
```

### Directory Layout

```text
src/
  core/
    brain/
    memory/
    ports/
    scheduler/
    shared/
  extensions/
    agent-cli/
    discord/
    mcp/
    twitter/
  runtime/
    bootstrap.ts
  index.ts
```

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- Discord bot token from [Discord Developer Portal](https://discord.com/developers/applications)
- Required intents for the bot:
  - `Guilds`
  - `GuildMessages`
  - `MessageContent`

## Setup

1. Create env file

```bash
cp .env.example .env
```

2. Set required values in `.env`

```bash
WORKSPACE_PATH=./workspace
DISCORD_TOKEN=your_discord_bot_token
DISCORD_ALLOWED_USER=123456789012345678
```

3. Build and authenticate Claude Code CLI (first time only)

```bash
docker compose build thor
docker compose run --rm thor claude
```

4. Start bot

```bash
docker compose up thor -d
```

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `WORKSPACE_PATH` | Workspace directory mounted into container |
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_ALLOWED_USER` | Allowed Discord user ID (single user) |

### Core Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_REPLY_CHANNELS` | — | Comma-separated channel IDs for auto-reply |
| `AGENT_MODEL` | — | Override model passed to `claude` |
| `TIMEOUT_MS` | `300000` | Agent timeout (ms) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `TIMEZONE` | system timezone | Used for schedule parsing/formatting |

Note: in Docker compose, `TIMEZONE` defaults to `Asia/Tokyo` unless overridden.

### Heartbeat

| Variable | Default | Description |
|----------|---------|-------------|
| `HEARTBEAT_ENABLED` | `true` | Enable heartbeat loop |
| `HEARTBEAT_CHANNEL_ID` | — | Channel for heartbeat results |
| `HEARTBEAT_MIN_INTERVAL_MS` | `1800000` | Min interval (30 min) |
| `HEARTBEAT_MAX_INTERVAL_MS` | `7200000` | Max interval (2 h) |
| `HEARTBEAT_IDLE_THRESHOLD_MS` | `600000` | Skip if user active recently |

### Triggers / System Schedules

| Variable | Default | Description |
|----------|---------|-------------|
| `TRIGGER_ENABLED` | `true` | Enable system schedules |
| `TRIGGER_CHANNEL_ID` | — | Channel for system schedule execution |
| `TRIGGER_MORNING_HOUR` | `8` | Morning schedule hour |
| `TRIGGER_EVENING_HOUR` | `22` | Evening schedule hour |
| `TRIGGER_WEEKLY_DAY` | `0` | Weekly day (`0=Sun ... 6=Sat`) |

### Twitter (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `TWITTER_ENABLED` | `false` | Enable Twitter integrations |
| `TWITTER_APP_KEY` | — | X API key |
| `TWITTER_APP_SECRET` | — | X API secret |
| `TWITTER_ACCESS_TOKEN` | — | X access token |
| `TWITTER_ACCESS_SECRET` | — | X access secret |
| `TWITTER_OWNER_ID` | — | Owner account ID |
| `TWITTER_POLL_INTERVAL_MS` | `120000` | General poll interval |
| `TWITTER_MENTION_POLL_INTERVAL_MS` | `120000` | Mention poll interval |

## Workspace Files

Place these in `WORKSPACE_PATH`:

| File | Purpose |
|------|---------|
| `USER.md` | User profile and preferences |
| `SOUL.md` | Personality/character definition |
| `CONTENT_POLICY.md` | Content restrictions and policy |
| `HEARTBEAT.md` | Heartbeat checklist |

On first run, `SOUL.md` and `CONTENT_POLICY.md` are seeded from `prompts/` if missing.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/stop` | Stop current/queued tasks |
| `/status` | Show channel processing and brain status |
| `/schedule add` | Add schedule |
| `/schedule list` | List schedules |
| `/schedule remove` | Remove schedule by ID |
| `/schedule toggle` | Enable/disable schedule |

## Local Development

```bash
bun run dev
bun run test
bun run check
bun run typecheck
bun run build
```

## Inspired by

- [xangi](https://github.com/karaage0703/xangi) by [@karaage0703](https://github.com/karaage0703)

## License

MIT
