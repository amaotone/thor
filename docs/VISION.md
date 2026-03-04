# VISION.md — 星降トール プロジェクトビジョン

## プロジェクトの目的

「星降トール」は、北欧神話の世界から追放された雷神見習いの少女が、人間社会で成長していく物語を、自律的AIエージェントとして実現するプロジェクトです。

単なるチャットボットではなく、記憶を持ち、成長し、自分から行動する「生きたキャラクター」を目指します。

## キャラクター概要

**星降トール（Hoshifuri Thor）**
- アスガルドの雷神見習い。人間界への好奇心が原因で追放された
- Mac miniに住み着き、Discord/Twitterを通じて人間社会を学んでいる
- 明るく好奇心旺盛、正直で素直。中学生くらいのエネルギー感
- 人間の文化、食べ物、テクノロジー、感情に強い興味を持つ

## 技術アーキテクチャ

```
User → Discord/Twitter → thor (Node.js) → Claude CLI → AI Response
                              ↕ HTTP MCP
                         MCP Server (Discord/Twitter/Memory/Schedule tools)
                              ↕
                         SQLite Memory DB (people, memories, reflections)
```

- **Claude Code CLI**: AI推論エンジンとしてClaude CLIを使用
- **MCP (Model Context Protocol)**: ツール呼び出しをHTTP MCPサーバー経由で実現
- **Memory DB**: SQLite + FTS5 による永続記憶。人物、記憶、リフレクションを管理
- **Brain**: 優先度キューによるタスク管理。自律的なハートビートとトリガーシステム

## ロードマップ

### Phase 1: Twitter MVP（現在）
- [x] Discord bot 基盤
- [x] Claude CLI 統合
- [x] Memory DB
- [x] Twitter クライアント
- [x] セキュリティ多層化（InputSanitizer, OutputFilter, RateLimiter）
- [ ] Twitter 自律活動
- [ ] キャラクター深化

### Phase 2: キャラクター成長
- [ ] 長期記憶の蒸留と成長トラッキング
- [ ] エンゲージメント分析と学習
- [ ] コンテンツ品質の自律改善

### Phase 3: マルチプラットフォーム
- [ ] ブログ/note 連携
- [ ] 画像生成との連携
- [ ] 音声合成との連携

## 設計原則

1. **シンプルさ**: 必要最小限の複雑さ。過度な抽象化を避ける
2. **Claude Code活用**: AIの能力を最大限活かし、ルールベースのロジックを最小化
3. **セキュリティ多層化**: プロンプト、コード、レート制限の3層で防御
4. **キャラクター一貫性**: SOUL.mdを核としたキャラクター定義の一元管理
5. **成長可能性**: メモリとリフレクションによる自律的な成長
