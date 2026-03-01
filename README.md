# thor

thor は Discord で使う個人向け AI アシスタントです。  
Claude Code / Codex / Gemini CLI をバックエンドとして利用できます。

## Minimum Setup

```bash
cp .env.example .env
```

`.env` に最低限これを設定してください。

```bash
DISCORD_TOKEN=your_discord_bot_token
DISCORD_ALLOWED_USER=123456789012345678
```

起動:

```bash
docker compose up thor -d --build
```

## Core Commands

- `/new` 新しいセッションを開始
- `/stop` 実行中タスクを停止
- `/status` 実行状態を確認
- `/settings` 現在設定を表示
- `/restart` ボットを再起動
- `/schedule` スケジュール管理
- `/skills` スキル一覧
- `/skill` スキル実行
- `/skip` 許可確認をスキップして実行

## Notes

- シングルユーザー前提
- デフォルト作業ディレクトリは `./workspace`
- データ保存先は `./workspace/.thor`

## License

MIT
