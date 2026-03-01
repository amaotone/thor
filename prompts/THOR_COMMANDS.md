# THOR_COMMANDS.md - thor Reference Guide

Commands, settings, and operational rules specific to thor.
**Read this at the start of every session.**

## Discord Operation Commands

**⚠️ `!discord` commands are NOT Bash commands!**
Write them directly in your response text. Running them with the Bash tool will cause a `command not found` error.
thor processes text output line by line.

**📏 Formatting Rules (all commands):**
- **Must be at the start of a line** — Each line is trimmed then checked with `startsWith`, so commands written mid-line won't be recognized
- **Ignored inside code blocks** — Commands within ` ``` ` blocks are not executed (safe for documentation examples)
- `!discord`, `!schedule`, `SYSTEM_COMMAND:` must all be at the start of a line
- `MEDIA:` is the exception — it is recognized even mid-line

### Send a Message to Another Channel

```
!discord send <#channelID> message content
```

**Examples:**
```
!discord send <#1469606785672417383> hello!
!discord send <#1466570723639165072> Starting work now
```

**Notes:**
- Follow the `<#channelID>` format (wrap with `<#` and `>`)
- When asked "say XX in YY channel", use this command

### List Channels

```
!discord channels
```

### Get Channel History

```
!discord history [count] [<#channelID>]
```

Get the latest messages from a channel. **Results are returned to your context, not sent to Discord.**

- Default count is 10, maximum 100
- If channel ID is omitted, uses the current channel
- Use `offset:N` to go further back (fetch 30 at a time to prevent timeouts)
- Each message includes `(ID:messageID)`, which can be used with `!discord delete`

**Examples:**
```
!discord history              # Latest 10 messages in current channel
!discord history 50           # Latest 50 messages in current channel
!discord history 20 <#1466570723639165072>  # 20 messages from specified channel
!discord history 30 offset:30   # Get messages 30-60
!discord history 30 offset:60   # Get messages 60-90
!discord history 30 offset:30 <#1466570723639165072>  # Go back in another channel
```

**When fetching large amounts of history (to avoid timeouts):**
Instead of fetching 100 at once, paginate 30 at a time:
1. `!discord history 30` → Latest 30 messages
2. `!discord history 30 offset:30` → Messages 30-60
3. `!discord history 30 offset:60` → Messages 60-90

**Use cases:**
- Regain conversation context after a session reset
- Reference past conversations for decision-making
- Incrementally fetch a full day's conversation history for journaling

### Delete a Message

```
!discord delete <messageID>      # Delete a specific message
!discord delete <messageLink>    # Delete message at link (works across channels)
```

- A message ID or link is required (cannot be called without arguments)
- Only your own (bot) messages can be deleted (cannot delete others' messages)
- Message links use the `https://discord.com/channels/...` format

**⚠️ Important: Deletion steps when a user pastes a message link:**
1. Do **NOT** run `!discord history` (unnecessary)
2. Pass the link directly to `!discord delete <link>`
3. Example: User pastes `https://discord.com/channels/111/222/333` and says "delete it" → `!discord delete https://discord.com/channels/111/222/333`

Only check history for the ID when neither a link nor ID is provided, e.g., "delete the last one."

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


## Schedules & Reminders

Use `!schedule` commands to set up reminders and recurring tasks.

### Configuration File

Stored in `.thor/schedules.json`. Can also be edited manually.

### Commands

```
!schedule add <config>     # Add a schedule
!schedule list             # List all schedules
!schedule remove <ID>      # Remove a schedule
!schedule toggle <ID>      # Enable/disable toggle
```

### Schedule Format

- `in 30 minutes meeting` — In N minutes (seconds/hours also work)
- `15:00 review` — At that time today (next day if already past)
- `2025-03-01 14:00 deadline` — Specific date and time
- `every day 9:00 good morning` — Daily at a fixed time
- `every hour check` — At the top of every hour
- `every Monday 10:00 weekly meeting` — Weekly (Mon-Sun supported)
- `cron 0 9 * * * good morning` — Direct cron expression

### Sending to Another Channel

Prefix with `-c <#channelID>` or `<#channelID>` to send to a specific channel.

```
!schedule add -c <#1469606785672417383> in 3 minutes test message
!schedule add <#1469606785672417383> every day 9:00 good morning
```

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
