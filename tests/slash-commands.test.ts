import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunner } from '../src/agent-runner.js';
import type { Skill } from '../src/skills.js';
import {
  buildSlashCommands,
  formatChannelStatus,
  handleAutocomplete,
  handleSlashCommand,
  type SlashCommandDeps,
} from '../src/slash-commands.js';

// Mock settings module
vi.mock('../src/settings.js', () => ({
  loadSettings: vi.fn().mockReturnValue({ autoRestart: false }),
  formatSettings: vi.fn().mockReturnValue('⚙️ Settings'),
  saveSettings: vi.fn(),
}));

// Mock message-handler
vi.mock('../src/message-handler.js', () => ({
  executeSkillCommand: vi.fn().mockResolvedValue(undefined),
}));

// Mock schedule-handler
vi.mock('../src/schedule-handler.js', () => ({
  handleScheduleCommand: vi.fn().mockResolvedValue(undefined),
}));

import { executeSkillCommand } from '../src/message-handler.js';
import { loadSettings } from '../src/settings.js';

// ─── Test helpers ──────────────────────────────────────────
function createMockAgentRunner(overrides: Partial<AgentRunner> = {}): AgentRunner {
  return {
    run: vi.fn().mockResolvedValue({ result: 'done' }),
    runStream: vi.fn().mockResolvedValue({ result: 'done' }),
    getSessionId: vi.fn().mockReturnValue(null),
    deleteSession: vi.fn(),
    destroy: vi.fn(),
    cancelAll: vi.fn().mockReturnValue(0),
    getStatus: vi.fn().mockReturnValue(null),
    shutdown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AgentRunner;
}

function createMockInteraction(commandName: string, options: Record<string, unknown> = {}) {
  return {
    commandName,
    channelId: 'ch-test',
    channel: { send: vi.fn().mockResolvedValue(undefined) },
    options: {
      getString: vi.fn().mockImplementation((key: string) => options[key] ?? null),
      getSubcommand: vi.fn().mockReturnValue(options.subcommand ?? null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof handleSlashCommand>[0];
}

function createDeps(overrides: Partial<SlashCommandDeps> = {}): SlashCommandDeps {
  return {
    agentRunner: createMockAgentRunner(),
    scheduler: {} as SlashCommandDeps['scheduler'],
    config: { discord: {}, agent: {} } as SlashCommandDeps['config'],
    skills: [],
    processingChannels: new Map(),
    workdir: '/tmp/test',
    reloadSkills: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

// ─── formatChannelStatus ───────────────────────────────────
describe('formatChannelStatus', () => {
  it('should show idle status when no processing', () => {
    const runner = createMockAgentRunner();
    const result = formatChannelStatus('ch-1', new Map(), runner);
    expect(result).toContain('🔓 待機中');
    expect(result).toContain('❌ なし');
  });

  it('should show processing count when channel is active', () => {
    const runner = createMockAgentRunner();
    const channels = new Map([['ch-1', 3]]);
    const result = formatChannelStatus('ch-1', channels, runner);
    expect(result).toContain('🔒 3件処理中');
  });

  it('should show session id when present', () => {
    const runner = createMockAgentRunner({
      getSessionId: vi.fn().mockReturnValue('abcdef123456789'),
    });
    const result = formatChannelStatus('ch-1', new Map(), runner);
    expect(result).toContain('✅ abcdef123456...');
  });

  it('should show runner pool status when available', () => {
    const runner = createMockAgentRunner({
      getStatus: vi.fn().mockReturnValue({
        poolSize: 2,
        maxProcesses: 5,
        channels: [{ channelId: 'ch-1', alive: true, idleSeconds: 10 }],
      }),
    });
    const result = formatChannelStatus('ch-1', new Map(), runner);
    expect(result).toContain('Runner pool: 2/5');
    expect(result).toContain('✅ alive');
    expect(result).toContain('idle 10s');
  });

  it('should show "なし" when channel has no runner', () => {
    const runner = createMockAgentRunner({
      getStatus: vi.fn().mockReturnValue({
        poolSize: 1,
        maxProcesses: 5,
        channels: [{ channelId: 'other-ch', alive: true, idleSeconds: 0 }],
      }),
    });
    const result = formatChannelStatus('ch-1', new Map(), runner);
    expect(result).toContain('チャンネルランナー: なし');
  });
});

// ─── handleAutocomplete ────────────────────────────────────
describe('handleAutocomplete', () => {
  it('should filter skills by name', async () => {
    const skills: Skill[] = [
      { name: 'deploy', description: 'Deploy to prod', prompt: '' },
      { name: 'test', description: 'Run tests', prompt: '' },
      { name: 'debug', description: 'Debug app', prompt: '' },
    ];
    const interaction = {
      options: { getFocused: vi.fn().mockReturnValue('de') },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleAutocomplete>[0];

    await handleAutocomplete(interaction, skills);

    const responded = (interaction.respond as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(responded).toHaveLength(2); // deploy, debug
    expect(responded.map((r: { value: string }) => r.value)).toContain('deploy');
    expect(responded.map((r: { value: string }) => r.value)).toContain('debug');
  });

  it('should filter skills by description', async () => {
    const skills: Skill[] = [
      { name: 'a', description: 'Deploy to production', prompt: '' },
      { name: 'b', description: 'Run unit tests', prompt: '' },
    ];
    const interaction = {
      options: { getFocused: vi.fn().mockReturnValue('prod') },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleAutocomplete>[0];

    await handleAutocomplete(interaction, skills);

    const responded = (interaction.respond as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(responded).toHaveLength(1);
    expect(responded[0].value).toBe('a');
  });

  it('should limit results to 25', async () => {
    const skills: Skill[] = Array.from({ length: 30 }, (_, i) => ({
      name: `skill-${i}`,
      description: `desc ${i}`,
      prompt: '',
    }));
    const interaction = {
      options: { getFocused: vi.fn().mockReturnValue('') },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleAutocomplete>[0];

    await handleAutocomplete(interaction, skills);

    const responded = (interaction.respond as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(responded).toHaveLength(25);
  });
});

// ─── buildSlashCommands ────────────────────────────────────
describe('buildSlashCommands', () => {
  it('should include all built-in commands', () => {
    const commands = buildSlashCommands([]);
    const names = commands.map((c) => c.name);
    expect(names).toContain('new');
    expect(names).toContain('stop');
    expect(names).toContain('status');
    expect(names).toContain('settings');
    expect(names).toContain('restart');
    expect(names).toContain('schedule');
    expect(names).toContain('personalize');
    expect(names).toContain('skills');
    expect(names).toContain('skill');
  });

  it('should add skill-based commands', () => {
    const skills: Skill[] = [{ name: 'deploy', description: 'Deploy app', prompt: '' }];
    const commands = buildSlashCommands(skills);
    const names = commands.map((c) => c.name);
    expect(names).toContain('deploy');
  });

  it('should normalize skill names for slash commands', () => {
    const skills: Skill[] = [{ name: 'My_Skill!', description: 'Test', prompt: '' }];
    const commands = buildSlashCommands(skills);
    const names = commands.map((c) => c.name);
    expect(names).toContain('my-skill-');
  });
});

// ─── handleSlashCommand ────────────────────────────────────
describe('handleSlashCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle /new command', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('new');

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(deps.agentRunner.deleteSession).toHaveBeenCalledWith('ch-test');
    expect(deps.agentRunner.destroy).toHaveBeenCalledWith('ch-test');
    expect(interaction.reply).toHaveBeenCalledWith('🆕 新しいセッションを開始しました');
  });

  it('should handle /stop with active tasks', async () => {
    const deps = createDeps({
      agentRunner: createMockAgentRunner({ cancelAll: vi.fn().mockReturnValue(2) }),
      processingChannels: new Map([['ch-test', 3]]),
    });
    const interaction = createMockInteraction('stop');

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(deps.processingChannels.has('ch-test')).toBe(false);
    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('🛑');
    expect(replyArg).toContain('2件キャンセル');
  });

  it('should handle /stop with no active tasks', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('stop');

    await handleSlashCommand(interaction, 'ch-test', deps);

    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('実行中のタスクはありません');
  });

  it('should handle /status command', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('status');

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(interaction.reply).toHaveBeenCalled();
    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('📊');
  });

  it('should handle /settings show', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('settings');

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(loadSettings).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should handle /settings update', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('settings', {
      key: 'autoRestart',
      value: 'true',
    });

    await handleSlashCommand(interaction, 'ch-test', deps);

    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('autoRestart');
    expect(replyArg).toContain('true');
  });

  it('should handle /restart when autoRestart disabled', async () => {
    vi.mocked(loadSettings).mockReturnValue({ autoRestart: false });
    const deps = createDeps();
    const interaction = createMockInteraction('restart');

    await handleSlashCommand(interaction, 'ch-test', deps);

    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('⚠️');
    expect(replyArg).toContain('無効');
  });

  it('should handle /skills command', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('skills');

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(deps.reloadSkills).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should handle /skill command', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('skill', { name: 'deploy', args: '--prod' });

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(executeSkillCommand).toHaveBeenCalledWith(
      interaction,
      deps.agentRunner,
      'ch-test',
      'deploy',
      '--prod'
    );
  });

  it('should handle individual skill command', async () => {
    const skills: Skill[] = [{ name: 'deploy', description: 'Deploy', prompt: '' }];
    const deps = createDeps({ skills });
    const interaction = createMockInteraction('deploy', { args: '' });

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(executeSkillCommand).toHaveBeenCalledWith(
      interaction,
      deps.agentRunner,
      'ch-test',
      'deploy',
      ''
    );
  });
});
