# THOR_COMMANDS.md - thor Reference Guide

Commands, settings, and operational rules specific to thor.
**Read this at the start of every session.**

## MCP Tools (Discord & Schedule)

thor provides MCP tools that you can call directly. These are available as `mcp__thor__*` tools:

- `discord_send` — Send a message to a Discord channel
- `discord_channels` — List text channels in the current guild
- `discord_history` — Fetch recent messages from a channel
- `discord_delete` — Delete a bot message by ID or link
- `schedule_create` — Create a schedule (cron, one-time, relative)
- `schedule_list` — List all schedules
- `schedule_remove` — Remove a schedule by ID
- `schedule_toggle` — Enable/disable a schedule

Use these tools instead of writing commands in your response text.

---

## File Sending

To send a file in chat, include a path in your output using the format below (**does not need to be at the start of a line** — recognized anywhere in the text):

```
MEDIA:/path/to/file
```

**Supported formats:** png, jpg, jpeg, gif, webp, mp3, mp4, wav, flac, pdf, zip

**Example:**
```
Image generated.
MEDIA:/tmp/output.png
```

User-attached files are provided as `[Attached file]` with their path.
Attachments are stored at: `[STATE_DIR]/media/attachments/`

---

## System Commands

Include the following in your response to control the system (must be at the start of a line):

- `SYSTEM_COMMAND:restart` — Restart the bot

When the user requests a restart, include `SYSTEM_COMMAND:restart`.
Slash commands `/restart` and `/settings` are also available.

## Auto-Expansion Features (Read-Only)

These are handled automatically by thor — no commands needed:

- `https://discord.com/channels/.../...` link → Expands the linked message content
- `<#channelId>` or `#channelName` → Expands latest 10 messages from that channel


## Handling Timeouts

thor's default timeout is 5 minutes (300,000 ms).
For tasks that take longer than 5 minutes, run them in the background and immediately respond with "execution started."

### `nohup` vs `run_in_background`

- **`nohup command > log 2>&1 &` (recommended)** — Survives Claude Code process exit. Safe against timeouts and session disconnects.
- **`run_in_background: true`** — Runs inside the Claude Code process, so if the process is killed at timeout (5 min), the background task dies with it.

**Bottom line: Use `nohup` for long-running tasks.** `run_in_background` is only suitable for short background tasks while the process is alive.

```bash
# Example for long-running tasks
nohup long-running-command > /tmp/output.log 2>&1 &
echo "PID: $!"
```

In the next interaction, check results with `tail /tmp/output.log` and report back.

### Tasks That Should Always Run in the Background
- Transcription
- Large builds
- Long downloads
