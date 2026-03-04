import { beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import type { Brain } from '../src/core/brain/brain.js';
import {
  buildSlashCommands,
  formatChannelStatus,
  handleSlashCommand,
  type SlashCommandDeps,
} from '../src/extensions/discord/slash-commands.js';

// ─── Test helpers ──────────────────────────────────────────
function createMockBrain(overrides: Partial<Brain> = {}): Brain {
  return {
    run: mock().mockResolvedValue({ result: 'done', sessionId: 'test' }),
    runStream: mock().mockResolvedValue({ result: 'done', sessionId: 'test' }),
    cancel: mock().mockReturnValue(false),
    cancelAll: mock().mockReturnValue(0),
    shutdown: mock(),
    isBusy: mock().mockReturnValue(false),
    getIdleTime: mock().mockReturnValue(0),
    getSessionId: mock().mockReturnValue(''),
    getStatus: mock().mockReturnValue({
      busy: false,
      queueLength: 0,
      currentPriority: null,
      alive: false,
      sessionId: '',
    }),
    ...overrides,
  } as unknown as Brain;
}

function createMockInteraction(commandName: string, options: Record<string, unknown> = {}) {
  return {
    commandName,
    channelId: 'ch-test',
    channel: { send: mock().mockResolvedValue(undefined) },
    options: {
      getString: mock().mockImplementation((key: string) => options[key] ?? null),
      getSubcommand: mock().mockReturnValue(options.subcommand ?? null),
    },
    reply: mock().mockResolvedValue(undefined),
    editReply: mock().mockResolvedValue(undefined),
    deferReply: mock().mockResolvedValue(undefined),
    followUp: mock().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof handleSlashCommand>[0];
}

function createDeps(overrides: Partial<SlashCommandDeps> = {}): SlashCommandDeps {
  return {
    brain: createMockBrain(),
    scheduler: {} as SlashCommandDeps['scheduler'],
    config: { discord: {}, agent: {} } as SlashCommandDeps['config'],
    processingChannels: new Map(),
    handleScheduleCommand: mock().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── formatChannelStatus ───────────────────────────────────
describe('formatChannelStatus', () => {
  it('should show idle status when no processing', () => {
    const brain = createMockBrain();
    const result = formatChannelStatus('ch-1', new Map(), brain);
    expect(result).toContain('idle');
  });

  it('should show processing count when channel is active', () => {
    const brain = createMockBrain();
    const channels = new Map([['ch-1', 3]]);
    const result = formatChannelStatus('ch-1', channels, brain);
    expect(result).toContain('3 tasks');
  });

  it('should show session id when present', () => {
    const brain = createMockBrain({
      getStatus: mock().mockReturnValue({
        busy: false,
        queueLength: 0,
        currentPriority: null,
        alive: true,
        sessionId: 'abcdef123456789',
      }),
    });
    const result = formatChannelStatus('ch-1', new Map(), brain);
    expect(result).toContain('abcdef123456...');
  });

  it('should show brain status', () => {
    const brain = createMockBrain({
      getStatus: mock().mockReturnValue({
        busy: true,
        queueLength: 2,
        currentPriority: 0,
        alive: true,
        sessionId: 'test-session',
      }),
    });
    const result = formatChannelStatus('ch-1', new Map(), brain);
    expect(result).toContain('busy');
    expect(result).toContain('queue: 2');
  });
});

// ─── buildSlashCommands ────────────────────────────────────
describe('buildSlashCommands', () => {
  it('should include stop, status, and schedule commands', () => {
    const commands = buildSlashCommands();
    const names = commands.map((c) => c.name);
    expect(names).toContain('stop');
    expect(names).toContain('status');
    expect(names).toContain('schedule');
  });

  it('should not include removed commands', () => {
    const commands = buildSlashCommands();
    const names = commands.map((c) => c.name);
    expect(names).not.toContain('new');
    expect(names).not.toContain('settings');
    expect(names).not.toContain('restart');
    expect(names).not.toContain('skills');
    expect(names).not.toContain('skill');
    expect(names).not.toContain('personalize');
  });
});

// ─── handleSlashCommand ────────────────────────────────────
describe('handleSlashCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle /stop with active tasks', async () => {
    const deps = createDeps({
      brain: createMockBrain({ cancelAll: mock().mockReturnValue(2) }),
      processingChannels: new Map([['ch-test', 3]]),
    });
    const interaction = createMockInteraction('stop');

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(deps.processingChannels.has('ch-test')).toBe(false);
    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(replyArg).toContain('Stopped');
    expect(replyArg).toContain('2 cancelled');
  });

  it('should handle /stop with no active tasks', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('stop');

    await handleSlashCommand(interaction, 'ch-test', deps);

    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(replyArg).toContain('No tasks running');
  });

  it('should handle /status command', async () => {
    const deps = createDeps();
    const interaction = createMockInteraction('status');

    await handleSlashCommand(interaction, 'ch-test', deps);

    expect(interaction.reply).toHaveBeenCalled();
    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(replyArg).toContain('Status');
  });
});
