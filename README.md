<img width="240" height="240" alt="thor" src="https://github.com/user-attachments/assets/88576d65-dc44-4ab6-b76b-a6cadf4187fb" />

# thor

thor is a personal AI assistant for Discord.
It uses Claude Code as its backend.

## Features

- **Chat** — Talk to Claude directly in Discord. Responses stream in real time.
- **Persistent sessions** — Conversation context is retained per channel. Use `/new` to reset.
- **Scheduler** — Set one-time or recurring tasks with natural language (`in 30 minutes`, `every day 9:00`, cron expressions, etc.).
- **Skills** — Extend thor with custom skill files. List with `/skills`, run with `/skill`.
- **File sending** — thor can send files (images, PDFs, etc.) back to Discord.
- **Startup tasks** — Run agent prompts automatically on bot startup.

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
  - Required intents: `Message Content`, `Server Members`
- [Claude Code](https://claude.ai/code) installed and authenticated on the host machine (`claude` command must work)

## Minimum Setup

```bash
cp .env.example .env
```

Set the following in `.env` at minimum:

```bash
DISCORD_TOKEN=your_discord_bot_token
DISCORD_ALLOWED_USER=123456789012345678
```

Start:

```bash
docker compose up thor -d --build
```

## Core Commands

- `/new` Start a new session
- `/stop` Stop the running task
- `/status` Check current status
- `/settings` Show current settings
- `/restart` Restart the bot
- `/schedule` Manage schedules
- `/skills` List skills
- `/skill` Execute a skill

## Inspired by

- [xangi](https://github.com/karaage0703/xangi) by [@karaage0703](https://github.com/karaage0703)

## License

MIT
