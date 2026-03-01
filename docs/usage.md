# Usage Guide

A detailed usage guide for thor.

> **Related docs**: [Setup](setup.md) | [Architecture](architecture.md)

## Table of Contents

- [Basic Usage](#basic-usage)
- [Session Management](#session-management)
- [Scheduler](#scheduler)
- [Discord Commands](#discord-commands)
- [Command Prefixes](#command-prefixes)
- [Runtime Settings](#runtime-settings)
- [Autonomous AI Operations](#autonomous-ai-operations)

## Basic Usage

### Invoke via Mention

```
@thor your question
```

### Dedicated Channels

Channels set in `AUTO_REPLY_CHANNELS` will respond without requiring a mention.

## Session Management

| Command                     | Description              |
| --------------------------- | ------------------------ |
| `/new`, `!new`, `new`       | Start a new session      |
| `/clear`, `!clear`, `clear` | Clear session history    |
| `/status`, `!status`, `status` | Check execution status |

## Scheduler

Set up recurring tasks and reminders. The AI interprets natural language and automatically executes `!schedule` commands.

### Command List

| Command                         | Description                                  |
| ------------------------------- | -------------------------------------------- |
| `/schedule`                     | Manage schedules via slash command            |
| `!schedule <time> <message>`    | Add a schedule                               |
| `!schedule list` / `!schedule`  | List all schedules (all channels)            |
| `!schedule remove <number>`     | Remove (multiple: `remove 1 2 3`)            |
| `!schedule toggle <number>`     | Enable/disable toggle                        |

> The `/schedule` slash command provides the same functionality.

### Time Specification

#### One-Shot Reminders

```
in 30 minutes remind about XX
in 1 hour prepare for meeting
15:30 notify at 3:30 PM today
```

#### Recurring (Natural Language)

```
every day 9:00 morning greeting
every day 18:00 write daily report
every Monday 10:00 weekly report
every Friday 17:00 check weekend plans
```

#### Cron Expressions

For finer control, cron expressions are also supported:

```
0 9 * * * every day at 9 AM
0 */2 * * * every 2 hours
30 8 * * 1-5 weekdays at 8:30
0 0 1 * * first of every month
```

| Field      | Value | Description          |
| ---------- | ----- | -------------------- |
| Minute     | 0-59  |                      |
| Hour       | 0-23  |                      |
| Day        | 1-31  |                      |
| Month      | 1-12  |                      |
| Day of Week| 0-6   | 0=Sun, 1=Mon, ...    |

### CLI (Command Line)

```bash
# Add a schedule
bun src/schedule-cli.ts add --channel <channelId> "every day 9:00 good morning"

# List schedules
bun src/schedule-cli.ts list

# Remove by number
bun src/schedule-cli.ts remove --channel <channelId> 1

# Remove multiple
bun src/schedule-cli.ts remove --channel <channelId> 1 2 3

# Enable/disable toggle
bun src/schedule-cli.ts toggle --channel <channelId> 1
```

### Data Storage

Schedule data is saved in `${THOR_DATA_DIR}/schedules.json`.

- Default: `/workspace/.thor/schedules.json`
- Can be changed via the `THOR_DATA_DIR` environment variable

## Discord Commands

Commands for the AI to perform Discord operations.

| Command                                | Description                                                     |
| -------------------------------------- | --------------------------------------------------------------- |
| `!discord send <#channel> message`     | Send a message to a specified channel                           |
| `!discord channels`                    | List server channels                                            |
| `!discord history [count] [<#channel>]`| Get latest messages from a channel (default 10, max 100)        |
| `!discord search keyword`             | Search messages in current channel                              |
| `!discord delete <messageID>`          | Delete a specific message                                       |
| `!discord delete <messageLink>`        | Delete message at link (works across channels)                  |
| `!discord edit <ID/link/last> content` | Edit own message (`last` for the most recent message)           |

### Examples

```
# Post to another channel
!discord send <#1234567890> Work completed!

# Check channel list
!discord channels

# Get channel history (results are returned to AI context)
!discord history              # Latest 10 in current channel
!discord history 50           # Latest 50 in current channel
!discord history 20 <#1234>   # 20 from specified channel
!discord history 30 offset:30 # Get messages 30-60 (going back)

# Search messages
!discord search PR

# Delete by message ID
!discord delete 123456789012345678

# Delete by message link (works for other channels too)
!discord delete https://discord.com/channels/111/222/333

# Edit most recent own message
!discord edit last corrected content

# Edit by message ID
!discord edit 123456789012345678 new content
```

## Runtime Settings

Runtime settings are saved in `${WORKSPACE_PATH}/settings.json`.

```json
{
  "autoRestart": true
}
```

| Setting       | Description                          | Default |
| ------------- | ------------------------------------ | ------- |
| `autoRestart` | Allow AI agent to trigger restarts   | `true`  |

### Viewing & Changing Settings

| Command     | Description            |
| ----------- | ---------------------- |
| `/settings` | Show current settings  |
| `/restart`  | Restart the bot        |

## Autonomous AI Operations

### Settings Changes (Local Execution Only)

The AI can edit the `.env` file to change settings:

```
"Also respond in this channel"
→ AI edits AUTO_REPLY_CHANNELS → restart
```

### System Commands

Special commands output by the AI:

| Command                  | Description      |
| ------------------------ | ---------------- |
| `SYSTEM_COMMAND:restart` | Restart the bot  |

### Restart Mechanism

- **Docker**: Auto-recovers via `restart: always`
- **Local**: Requires a process manager like pm2

```bash
# Example using pm2
pm2 start "bun start" --name thor
pm2 logs thor
```

### Changing Environment Variables with pm2

thor loads environment variables via bun's automatic `.env` loading. To change environment variables, **edit the `.env` file and then `pm2 restart`**.

```bash
# Correct method: edit .env then restart
vim .env  # Add TIMEOUT_MS=60000
pm2 restart thor
```

> **⚠️ Do NOT use `pm2 restart --update-env`!**
> `--update-env` saves all shell environment variables to pm2. If you're running multiple thor instances, tokens like `DISCORD_TOKEN` from other instances may leak in, causing duplicate bot logins with the same token.
