import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';
import type { AgentRunner } from '../agent/agent-runner.js';
import type { Config } from '../lib/config.js';
import { DISCORD_SAFE_LENGTH } from '../lib/constants.js';
import { createLogger } from '../lib/logger.js';
import { splitMessage } from '../lib/message-utils.js';
import { formatSettings, loadSettings } from '../lib/settings.js';
import { formatSkillList, type Skill } from '../lib/skills.js';
import { handleScheduleCommand } from '../scheduler/schedule-handler.js';
import type { Scheduler } from '../scheduler/scheduler.js';
import { isSendableChannel } from './discord-types.js';
import { executeSkillCommand } from './message-handler.js';

const logger = createLogger('discord');

/**
 * チャンネルの実行状態をフォーマット
 */
export function formatChannelStatus(
  channelId: string,
  processingChannels: Map<string, number>,
  agentRunner: AgentRunner
): string {
  const count = processingChannels.get(channelId) ?? 0;
  const sessionId = agentRunner.getSessionId?.(channelId);

  const lines = ['📊 **現在の実行状態**'];
  lines.push(`- チャンネル: <#${channelId}>`);
  lines.push(`- 実行ロック: ${count > 0 ? `🔒 ${count}件処理中` : '🔓 待機中'}`);
  lines.push(`- セッション: ${sessionId ? `✅ ${sessionId.slice(0, 12)}...` : '❌ なし'}`);

  const status = agentRunner.getStatus?.();
  if (status) {
    const channelStatus = status.channels.find((c) => c.channelId === channelId);
    lines.push(`- Runner pool: ${status.poolSize}/${status.maxProcesses}`);
    if (channelStatus) {
      lines.push(
        `- チャンネルランナー: ${channelStatus.alive ? '✅ alive' : '⚠️ dead'} (idle ${channelStatus.idleSeconds}s)`
      );
    } else {
      lines.push('- チャンネルランナー: なし');
    }
  }

  return lines.join('\n');
}

/**
 * autocomplete ハンドラー
 */
export async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  skills: Skill[]
): Promise<void> {
  const focusedValue = interaction.options.getFocused().toLowerCase();

  const filtered = skills
    .filter(
      (skill) =>
        skill.name.toLowerCase().includes(focusedValue) ||
        skill.description.toLowerCase().includes(focusedValue)
    )
    .slice(0, 25)
    .map((skill) => ({
      name: `${skill.name} - ${skill.description.slice(0, 50)}`,
      value: skill.name,
    }));

  await interaction.respond(filtered);
}

/**
 * /personalize コマンドハンドラー
 */
export async function handlePersonalize(
  interaction: ChatInputCommandInteraction,
  agentRunner: AgentRunner,
  channelId: string
): Promise<void> {
  const target = interaction.options.getString('target') || 'both';

  agentRunner.deleteSession?.(channelId);
  agentRunner.destroy?.(channelId);
  await interaction.deferReply();

  const targetDesc =
    target === 'soul'
      ? 'SOUL.md（ボットの人格・性格）'
      : target === 'user'
        ? 'USER.md（ユーザー情報）'
        : 'SOUL.md（ボットの人格・性格）と USER.md（ユーザー情報）';

  const prompt = `ユーザーが /personalize コマンドを実行しました。${targetDesc}の作成・編集を対話的にサポートしてください。

## あなたのタスク

1. まずワークスペースの既存ファイルを確認してください:
   - SOUL.md: ボットの人格・口調・価値観を定義するファイル
   - USER.md: ユーザーの情報・好み・コンテキストを定義するファイル

2. ユーザーに質問しながら、ファイルの内容を一緒に考えてください:
${
  target === 'user'
    ? ''
    : `   - SOUL.md: どんな口調がいい？（フレンドリー/丁寧/カジュアル等）、性格は？、特別なルールは？
`
}${
  target === 'soul'
    ? ''
    : `   - USER.md: ユーザーの名前、興味・関心、よく使う技術、好みのコミュニケーションスタイル等
`
}
3. ユーザーの回答を元にファイルを作成・更新してください。

## 重要なルール
- 一度に全部聞かず、2-3個ずつ質問してください
- 既存ファイルがあれば内容を見せて、変更したい部分を聞いてください
- 最終的にファイルを書き出す前に内容を確認してもらってください
- Discordで会話しているので、返答は簡潔にしてください`;

  try {
    const { result } = await agentRunner.run(prompt, {
      channelId,
    });

    const chunks = splitMessage(result, DISCORD_SAFE_LENGTH);
    await interaction.editReply(chunks[0] || '✅');
    if (chunks.length > 1 && isSendableChannel(interaction.channel)) {
      for (let i = 1; i < chunks.length; i++) {
        await interaction.channel.send(chunks[i]);
      }
    }
  } catch (error) {
    logger.error('Personalize error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`❌ エラー: ${errorMsg.slice(0, 200)}`);
  }
}

/**
 * スラッシュコマンド定義を生成
 */
export function buildSlashCommands(skills: Skill[]): ReturnType<SlashCommandBuilder['toJSON']>[] {
  const commands: ReturnType<SlashCommandBuilder['toJSON']>[] = [
    new SlashCommandBuilder().setName('new').setDescription('新しいセッションを開始').toJSON(),
    new SlashCommandBuilder().setName('stop').setDescription('実行中のタスクを停止').toJSON(),
    new SlashCommandBuilder().setName('status').setDescription('実行状態を確認').toJSON(),
    new SlashCommandBuilder()
      .setName('settings')
      .setDescription('設定を表示・変更')
      .addStringOption((option) =>
        option
          .setName('key')
          .setDescription('設定キー')
          .setRequired(false)
          .addChoices({ name: 'autoRestart', value: 'autoRestart' })
      )
      .addStringOption((option) =>
        option.setName('value').setDescription('設定値').setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder().setName('restart').setDescription('プロセスを再起動').toJSON(),
    new SlashCommandBuilder()
      .setName('schedule')
      .setDescription('スケジュール管理')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('スケジュール追加')
          .addStringOption((opt) =>
            opt.setName('input').setDescription('スケジュール入力').setRequired(true)
          )
      )
      .addSubcommand((sub) => sub.setName('list').setDescription('スケジュール一覧'))
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('スケジュール削除')
          .addStringOption((opt) =>
            opt.setName('id').setDescription('スケジュールID').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('toggle')
          .setDescription('スケジュールの有効/無効切替')
          .addStringOption((opt) =>
            opt.setName('id').setDescription('スケジュールID').setRequired(true)
          )
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('personalize')
      .setDescription('SOUL.md / USER.md を対話的に作成・編集')
      .addStringOption((option) =>
        option
          .setName('target')
          .setDescription('編集対象')
          .setRequired(false)
          .addChoices(
            { name: 'both (SOUL.md + USER.md)', value: 'both' },
            { name: 'soul (ボットの人格)', value: 'soul' },
            { name: 'user (ユーザー情報)', value: 'user' }
          )
      )
      .toJSON(),
    new SlashCommandBuilder().setName('skills').setDescription('利用可能なスキル一覧').toJSON(),
    new SlashCommandBuilder()
      .setName('skill')
      .setDescription('スキルを実行')
      .addStringOption((option) =>
        option.setName('name').setDescription('スキル名').setRequired(true).setAutocomplete(true)
      )
      .addStringOption((option) => option.setName('args').setDescription('引数').setRequired(false))
      .toJSON(),
  ];

  for (const skill of skills) {
    commands.push(
      new SlashCommandBuilder()
        .setName(skill.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
        .setDescription(skill.description.slice(0, 100))
        .addStringOption((option) =>
          option.setName('args').setDescription('引数').setRequired(false)
        )
        .toJSON()
    );
  }

  return commands;
}

export interface SlashCommandDeps {
  agentRunner: AgentRunner;
  scheduler: Scheduler;
  config: Config;
  skills: Skill[];
  processingChannels: Map<string, number>;
  workdir: string;
  reloadSkills: () => Skill[];
}

/**
 * スラッシュコマンドのルーティング
 */
export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  channelId: string,
  deps: SlashCommandDeps
): Promise<void> {
  const { agentRunner, scheduler, skills, reloadSkills } = deps;

  if (interaction.commandName === 'new') {
    agentRunner.deleteSession?.(channelId);
    agentRunner.destroy?.(channelId);
    await interaction.reply('🆕 新しいセッションを開始しました');
    return;
  }

  if (interaction.commandName === 'stop') {
    const cancelledCount = agentRunner.cancelAll?.(channelId) ?? 0;
    deps.processingChannels.delete(channelId);
    if (cancelledCount > 0) {
      await interaction.reply(
        `🛑 タスクを停止しました${cancelledCount > 1 ? `（${cancelledCount}件キャンセル）` : ''}`
      );
    } else {
      await interaction.reply('実行中のタスクはありません');
    }
    return;
  }

  if (interaction.commandName === 'status') {
    await interaction.reply(formatChannelStatus(channelId, deps.processingChannels, agentRunner));
    return;
  }

  if (interaction.commandName === 'settings') {
    const key = interaction.options.getString('key');
    const value = interaction.options.getString('value');
    if (key && value !== null) {
      const settings = loadSettings();
      if (key === 'autoRestart') {
        settings.autoRestart = value === 'true';
        const { saveSettings } = await import('../lib/settings.js');
        saveSettings(settings);
      }
      await interaction.reply(`⚙️ \`${key}\` = \`${value}\``);
    } else {
      await interaction.reply(formatSettings(loadSettings()));
    }
    return;
  }

  if (interaction.commandName === 'restart') {
    const settings = loadSettings();
    if (!settings.autoRestart) {
      await interaction.reply('⚠️ 自動再起動が無効です。先に有効にしてください。');
      return;
    }
    await interaction.reply('🔄 再起動します...');
    setTimeout(() => process.exit(0), 1000);
    return;
  }

  if (interaction.commandName === 'schedule') {
    await handleScheduleCommand(interaction, scheduler, undefined);
    return;
  }

  if (interaction.commandName === 'personalize') {
    await handlePersonalize(interaction, agentRunner, channelId);
    return;
  }

  if (interaction.commandName === 'skills') {
    const reloaded = reloadSkills();
    await interaction.reply(formatSkillList(reloaded));
    return;
  }

  if (interaction.commandName === 'skill') {
    const skillName = interaction.options.getString('name', true);
    const args = interaction.options.getString('args') || '';
    await executeSkillCommand(interaction, agentRunner, channelId, skillName, args);
    return;
  }

  // 個別スキルコマンド
  const matchedSkill = skills.find(
    (s) => s.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') === interaction.commandName
  );
  if (matchedSkill) {
    const args = interaction.options.getString('args') || '';
    await executeSkillCommand(interaction, agentRunner, channelId, matchedSkill.name, args);
  }
}
