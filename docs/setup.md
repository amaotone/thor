# Setup Guide

Steps to set up thor for use with Discord.

## 1. Access the Discord Developer Portal

https://discord.com/developers/applications

Log in with your Discord account.

## 2. Create a New Application

1. Click **"New Application"** in the top right
2. Enter a name: `thor` (or any name)
3. Click **"Create"**

## 3. Create a Bot and Get the Token

1. Click **"Bot"** in the left menu
2. **"Reset Token"** → **"Yes, do it!"**
3. **Copy the displayed token** (you'll need it later)

> **Note**: The token is only shown once. If lost, you'll need to regenerate it.

## 4. Bot Permission Settings (Important)

On the same Bot page, configure **Privileged Gateway Intents**:

| Intent | Required | Description |
|--------|----------|-------------|
| Presence Intent | Optional | Get user online status |
| Server Members Intent | Optional | Get server member info |
| **Message Content Intent** | **Required** | Read message content |

**The bot cannot read messages without Message Content Intent enabled.**

## 5. Invite the Bot to Your Server

1. Left menu **"OAuth2"** → **"URL Generator"**
2. Select under **SCOPES**:
   - `bot`
   - `applications.commands` (for slash commands)
3. Select under **BOT PERMISSIONS**:
   - Send Messages
   - Send Messages in Threads
   - Read Message History
   - Add Reactions
   - Use Slash Commands
4. Copy the generated URL
5. Open the URL in a browser and select the server to invite the bot to

## 6. Set Environment Variables

```bash
cp .env.example .env
```

Set the following in `.env` at minimum:

```bash
# Discord Bot Token
DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE

# Allowed user ID (single user only)
DISCORD_ALLOWED_USER=YOUR_DISCORD_USER_ID
```

See [`.env.example`](../.env.example) for all environment variable options.

## 7. Start

### Docker (Recommended)

```bash
docker compose up thor -d --build
```

Check logs:

```bash
docker logs -f thor
```

#### Docker Container Structure

```
┌─────────────────────────────────────────┐
│ thor container                         │
├─────────────────────────────────────────┤
│ - Node.js 22                            │
│ - Claude Code CLI                       │
│ - GitHub CLI (gh)                       │
└─────────────────────────────────────────┘
         │
         ├── /workspace (bind mount)
         ├── /home/node/.claude (volume)
         └── /home/node/.config/gh (volume)
```

- Runs as non-root user (node)
- Only the workspace is mounted
- Credentials are persisted via volumes
- See [`docker-compose.yml`](../docker-compose.yml) for details

### Local Execution

```bash
bun run build
bun run start
```

## 8. Verify It Works

Mention the bot in your Discord server:

```
@thor Hello!
```

Or try the `/new` or `/skills` commands.

## Finding IDs

### Enable Developer Mode

1. Discord Settings → Advanced → Turn on **Developer Mode**

### User ID

1. Right-click a user → **"Copy User ID"**

### Channel ID

1. Right-click a channel → **"Copy Channel ID"**

## Troubleshooting

### Bot Not Responding

1. Check that **Message Content Intent** is ON
2. Check that the bot has been invited to the server
3. Check that `DISCORD_ALLOWED_USER` is set correctly

### Slash Commands Not Showing

1. Check that the bot was invited with the `applications.commands` scope
2. Remove the bot from the server and re-invite it
3. Restart Discord

### "Discord token not configured" Error

`DISCORD_TOKEN` in `.env` is empty. Set the token.

## Security Notes

- **Do not commit tokens to Git** (`.env` is already in `.gitignore`)
- **Do not expose tokens** (regenerate immediately if leaked)
- Limit usage to a single user via `DISCORD_ALLOWED_USER` (Claude Code Terms of Service compliance)

## Next Steps

- [Usage Guide](usage.md) — Detailed commands and features
- [Architecture](architecture.md) — Design and internals
