<img width="240" height="240" alt="thor" src="https://github.com/user-attachments/assets/88576d65-dc44-4ab6-b76b-a6cadf4187fb" />

# thor

thor is a personal AI assistant for Discord.
It uses Claude Code as its backend.

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
- `/stop` Stop running task
- `/status` Check execution status
- `/settings` Show current settings
- `/restart` Restart the bot
- `/schedule` Manage schedules
- `/skills` List skills
- `/skill` Execute a skill
- `/skip` Skip permission confirmation and execute

## Notes

- Designed for single-user use
- Default working directory is `./workspace`
- Data is stored in `./workspace/.thor`

## Inspired by

- [xangi](https://github.com/karaage0703/xangi) by [@karaage0703](https://github.com/karaage0703)

## License

MIT
