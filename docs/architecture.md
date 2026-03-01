# アーキテクチャ

thor のアーキテクチャと設計思想について説明します。

## 概要

thor は「Claude Code をチャットプラットフォームから使えるようにするラッパー」です。

```
User → Discord → thor → AI CLI → Workspace
```

## レイヤー構成

| レイヤー | 役割 | 実装 |
|----------|------|------|
| Chat | ユーザーインターフェース | Discord.js |
| thor | AI CLI の統合・制御 | index.ts, agent-runner.ts |
| AI CLI | 実際の AI 処理 | Claude Code |
| Workspace | ファイル・スキル | skills/, AGENTS.md |

## コンポーネント

### エントリーポイント（index.ts）

メインのオーケストレーター。以下を統合：

- Discord クライアントの初期化
- メッセージ受信とルーティング
- AI CLI の呼び出し
- スケジューラーの管理
- コマンド処理（`!discord`, `!schedule` 等）

### エージェントランナー（agent-runner.ts）

AI CLI を抽象化するインターフェース：

```typescript
interface AgentRunner {
  run(prompt: string, options?: RunOptions): Promise<RunResult>;
  runStream(prompt: string, callbacks: StreamCallbacks, options?: RunOptions): Promise<RunResult>;
}
```

### システムプロンプト（base-runner.ts）

thor が AI CLI に注入するシステムプロンプトを管理：

- **チャットプラットフォーム情報** — Discord 経由の会話であることを伝える短い固定テキスト
- **THOR_COMMANDS.md** — `prompts/THOR_COMMANDS.md` から Discord 操作コマンド・スケジューラー等の仕様を読み込み

AGENTS.md / CHARACTER.md / USER.md 等のワークスペース設定は、各 AI CLI の自動読み込み機能に委譲：

| CLI | 自動読み込みファイル | 注入方法 |
|-----|---------------------|----------|
| Claude Code | `CLAUDE.md` | `--append-system-prompt`（一回限り） |

### AI CLI アダプター

| ファイル | 対応 CLI | 特徴 |
|----------|---------|------|
| claude-code.ts | Claude Code | ストリーミング対応、セッション管理 |
| persistent-runner.ts | Claude Code（常駐） | `--input-format=stream-json` で常駐プロセス化、キュー管理、サーキットブレーカー |

### スケジューラー（scheduler.ts）

定期実行とリマインダーを管理：

- `cron`: cron 式による定期実行
- `once`: 単発リマインダー（指定時刻に 1 回実行）
- JSON ファイル（`${THOR_DATA_DIR}/schedules.json`）で永続化
- ファイル変更を監視して自動リロード（debounce 付き）
- タイムゾーンはサーバーの `TZ` 環境変数に従う

### スキルシステム（skills.ts）

ワークスペースの `skills/` ディレクトリからスキルを読み込み、スラッシュコマンドとして登録。

### 定数管理（constants.ts）

アプリケーション全体で使用する定数値を一元管理。

## データフロー

### メッセージ処理フロー

```
1. ユーザーがメッセージ送信
   ↓
2. Discord クライアントが受信
   ↓
3. 権限チェック（allowedUsers）
   ↓
4. 特殊コマンド判定
   - !discord → handleDiscordCommand()
   - !schedule → handleScheduleMessage()
   - /command → スラッシュコマンド処理
   ↓
5. AI CLI に転送（processPrompt）
   ↓
6. レスポンス処理
   - ストリーミング表示
   - ファイル添付抽出
   - SYSTEM_COMMAND 検出
   - !discord / !schedule 検出・実行
   ↓
7. ユーザーに返信
```

### スケジュール実行フロー

```
1. cron/タイマーがトリガー
   ↓
2. Scheduler.executeSchedule()
   ↓
3. agentRunner(prompt, channelId)
   - AI CLI でプロンプト実行
   ↓
4. sender(channelId, result)
   - 結果をチャンネルに送信
   ↓
5. 単発の場合は自動削除
```

## 設計思想

### シングルユーザー設計

thor は **1 人のユーザー** が使う前提で設計されています：

- 認証は `DISCORD_ALLOWED_USER` による単純な ID 照合
- セッションはチャンネル単位で管理
- マルチテナント機能は意図的に省略

### コマンドの自律実行

AI が出力する特殊コマンドを検出して自動実行：

| コマンド | 動作 |
|----------|------|
| `SYSTEM_COMMAND:restart` | プロセス再起動 |
| `!discord send ...` | Discord メッセージ送信 |
| `!schedule ...` | スケジュール操作 |

### 永続化戦略

| データ | 保存先 | 形式 |
|--------|--------|------|
| スケジュール | `${THOR_DATA_DIR}/schedules.json` | JSON |
| ランタイム設定 | `${WORKSPACE}/settings.json` | JSON |
| セッション | `${THOR_DATA_DIR}/sessions.json` | JSON（チャンネル ID → セッション ID） |

## 環境変数

環境変数の一覧は [`.env.example`](../.env.example) を参照してください。

## Docker

Docker 構成の詳細は [`docker-compose.yml`](../docker-compose.yml) および [セットアップガイド](setup.md) を参照してください。
