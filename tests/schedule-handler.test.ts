import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTypeLabel } from '../src/schedule-handler.js';

// --- Mock dependencies ---
vi.mock('../src/scheduler.js', () => ({
  parseScheduleInput: vi.fn(),
  formatScheduleList: vi.fn().mockReturnValue('📋 スケジュールはありません'),
  SCHEDULE_SEPARATOR: '{{SPLIT}}',
}));

vi.mock('../src/discord-types.js', () => ({
  isSendableChannel: vi.fn().mockReturnValue(true),
}));

import {
  executeScheduleFromResponse,
  handleScheduleCommand,
  handleScheduleMessage,
} from '../src/schedule-handler.js';
import { formatScheduleList, parseScheduleInput } from '../src/scheduler.js';

const mockParseScheduleInput = vi.mocked(parseScheduleInput);
const mockFormatScheduleList = vi.mocked(formatScheduleList);

// --- Test helpers ---
function createMockInteraction(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'ch-1',
    options: {
      getSubcommand: vi.fn().mockReturnValue('list'),
      getString: vi.fn().mockReturnValue(null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Parameters<typeof handleScheduleCommand>[0];
}

function createMockMessage(channelId = 'ch-1') {
  return {
    channel: { id: channelId, send: vi.fn().mockResolvedValue(undefined) },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof handleScheduleMessage>[0];
}

function createMockScheduler(schedules: Array<{ id: string; enabled?: boolean }> = []) {
  return {
    list: vi.fn().mockReturnValue(schedules),
    add: vi.fn().mockImplementation((s) => ({
      ...s,
      id: 'sch_new',
      createdAt: new Date().toISOString(),
      enabled: true,
    })),
    remove: vi.fn().mockReturnValue(true),
    toggle: vi.fn().mockImplementation((id) => {
      const found = schedules.find((s) => s.id === id);
      if (!found) return undefined;
      return { ...found, enabled: !(found.enabled ?? true) };
    }),
  } as unknown as Parameters<typeof handleScheduleCommand>[1];
}

// ─── getTypeLabel ──────────────────────────────────────────
describe('getTypeLabel', () => {
  it('should format cron type', () => {
    const result = getTypeLabel('cron', { expression: '0 9 * * *' });
    expect(result).toContain('🔄');
    expect(result).toContain('0 9 * * *');
  });

  it('should format startup type', () => {
    const result = getTypeLabel('startup', {});
    expect(result).toContain('🚀');
    expect(result).toContain('起動時に実行');
  });

  it('should format once type with runAt', () => {
    const result = getTypeLabel('once', { runAt: '2026-03-02T09:00:00.000Z' });
    expect(result).toContain('⏰');
  });

  it('should append channelInfo when provided', () => {
    const result = getTypeLabel('cron', {
      expression: '0 9 * * *',
      channelInfo: ' → <#123>',
    });
    expect(result).toContain('→ <#123>');
  });
});

// ─── handleScheduleCommand ─────────────────────────────────
describe('handleScheduleCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatScheduleList.mockReturnValue('📋 スケジュールはありません');
  });

  it('should reply with schedule list for "list" subcommand', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof vi.fn>).mockReturnValue('list');
    const scheduler = createMockScheduler();

    await handleScheduleCommand(interaction, scheduler);

    expect(scheduler.list).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reply with error when add input is invalid', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof vi.fn>).mockReturnValue('add');
    (interaction.options.getString as ReturnType<typeof vi.fn>).mockReturnValue('invalid input');
    mockParseScheduleInput.mockReturnValue(null);
    const scheduler = createMockScheduler();

    await handleScheduleCommand(interaction, scheduler);

    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(replyArg.content).toContain('❌');
    expect(replyArg.ephemeral).toBe(true);
  });

  it('should add schedule and reply with success for valid add input', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof vi.fn>).mockReturnValue('add');
    (interaction.options.getString as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
      key === 'input' ? '毎日 9:00 おはよう' : null
    );
    mockParseScheduleInput.mockReturnValue({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'おはよう',
    });
    const scheduler = createMockScheduler();

    await handleScheduleCommand(interaction, scheduler);

    expect(scheduler.add).toHaveBeenCalled();
    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('✅');
    expect(replyArg).toContain('sch_new');
  });

  it('should remove schedule by id', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof vi.fn>).mockReturnValue('remove');
    (interaction.options.getString as ReturnType<typeof vi.fn>).mockReturnValue('sch_abc');
    const scheduler = createMockScheduler();

    await handleScheduleCommand(interaction, scheduler);

    expect(scheduler.remove).toHaveBeenCalledWith('sch_abc');
    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('🗑️');
  });

  it('should reply with error when remove id not found', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof vi.fn>).mockReturnValue('remove');
    (interaction.options.getString as ReturnType<typeof vi.fn>).mockReturnValue('sch_missing');
    const scheduler = createMockScheduler();
    (scheduler.remove as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await handleScheduleCommand(interaction, scheduler);

    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('❌');
  });

  it('should toggle schedule and reply with status', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof vi.fn>).mockReturnValue('toggle');
    (interaction.options.getString as ReturnType<typeof vi.fn>).mockReturnValue('sch_1');
    const scheduler = createMockScheduler([{ id: 'sch_1', enabled: true }]);

    await handleScheduleCommand(interaction, scheduler);

    expect(scheduler.toggle).toHaveBeenCalledWith('sch_1');
    const replyArg = (interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('⏸️ 無効');
  });
});

// ─── handleScheduleMessage ─────────────────────────────────
describe('handleScheduleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatScheduleList.mockReturnValue('📋 スケジュールはありません');
  });

  it('should list schedules for "!schedule" (no args)', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();

    await handleScheduleMessage(message, '!schedule', scheduler);

    expect(scheduler.list).toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalled();
  });

  it('should list schedules for "!schedule list"', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();

    await handleScheduleMessage(message, '!schedule list', scheduler);

    expect(scheduler.list).toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalled();
  });

  it('should remove schedule by id with "!schedule remove"', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler([{ id: 'sch_1' }]);

    await handleScheduleMessage(message, '!schedule remove sch_1', scheduler);

    expect(scheduler.remove).toHaveBeenCalledWith('sch_1');
    const replyArg = (message.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('✅');
    expect(replyArg).toContain('1件削除');
  });

  it('should remove schedule by number index', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler([{ id: 'sch_a' }, { id: 'sch_b' }]);

    await handleScheduleMessage(message, '!schedule remove 2', scheduler);

    expect(scheduler.remove).toHaveBeenCalledWith('sch_b');
  });

  it('should report error for out-of-range number', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler([{ id: 'sch_a' }]);

    await handleScheduleMessage(message, '!schedule remove 5', scheduler);

    const replyArg = (message.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('⚠️');
    expect(replyArg).toContain('番号 5 は範囲外');
  });

  it('should fall through to add path for "!schedule remove" (no id)', async () => {
    // args = "remove" after trim, "remove".startsWith("remove ") is false (no trailing space)
    // So it falls through to the add path, and parseScheduleInput returns null → error
    const message = createMockMessage();
    const scheduler = createMockScheduler();
    mockParseScheduleInput.mockReturnValue(null);

    await handleScheduleMessage(message, '!schedule remove', scheduler);

    const replyArg = (message.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('❌');
    expect(replyArg).toContain('対応フォーマット');
  });

  it('should support "!schedule delete" alias', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler([{ id: 'sch_x' }]);

    await handleScheduleMessage(message, '!schedule delete sch_x', scheduler);

    expect(scheduler.remove).toHaveBeenCalledWith('sch_x');
  });

  it('should support "!schedule rm" alias', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler([{ id: 'sch_y' }]);

    await handleScheduleMessage(message, '!schedule rm sch_y', scheduler);

    expect(scheduler.remove).toHaveBeenCalledWith('sch_y');
  });

  it('should toggle schedule by id', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler([{ id: 'sch_1', enabled: true }]);

    await handleScheduleMessage(message, '!schedule toggle sch_1', scheduler);

    expect(scheduler.toggle).toHaveBeenCalledWith('sch_1');
  });

  it('should toggle schedule by number index', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler([{ id: 'sch_a', enabled: true }]);
    (scheduler.list as ReturnType<typeof vi.fn>).mockReturnValue([{ id: 'sch_a', enabled: true }]);

    await handleScheduleMessage(message, '!schedule toggle 1', scheduler);

    expect(scheduler.toggle).toHaveBeenCalledWith('sch_a');
  });

  it('should add schedule for "!schedule add ..." with valid input', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();
    mockParseScheduleInput.mockReturnValue({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'おはよう',
    });

    await handleScheduleMessage(message, '!schedule add 毎日 9:00 おはよう', scheduler);

    expect(scheduler.add).toHaveBeenCalled();
    const replyArg = (message.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('✅');
  });

  it('should add schedule for "!schedule ..." without "add" prefix', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();
    mockParseScheduleInput.mockReturnValue({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'おはよう',
    });

    await handleScheduleMessage(message, '!schedule 毎日 9:00 おはよう', scheduler);

    expect(scheduler.add).toHaveBeenCalled();
  });

  it('should reply with error for unparseable input', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();
    mockParseScheduleInput.mockReturnValue(null);

    await handleScheduleMessage(message, '!schedule なんか変なもの', scheduler);

    const replyArg = (message.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain('❌');
    expect(replyArg).toContain('対応フォーマット');
  });
});

// ─── executeScheduleFromResponse ───────────────────────────
describe('executeScheduleFromResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatScheduleList.mockReturnValue('📋 スケジュールはありません');
  });

  it('should list schedules for "!schedule list"', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();

    await executeScheduleFromResponse('!schedule list', message, scheduler);

    expect(scheduler.list).toHaveBeenCalled();
    expect(message.channel.send).toHaveBeenCalled();
  });

  it('should remove schedules for "!schedule remove sch_1"', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler([{ id: 'sch_1' }]);

    await executeScheduleFromResponse('!schedule remove sch_1', message, scheduler);

    expect(scheduler.remove).toHaveBeenCalledWith('sch_1');
  });

  it('should add schedule for valid input', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();
    mockParseScheduleInput.mockReturnValue({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'おはよう',
    });

    await executeScheduleFromResponse('!schedule 毎日 9:00 おはよう', message, scheduler);

    expect(scheduler.add).toHaveBeenCalled();
  });

  it('should silently ignore unparseable input', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();
    mockParseScheduleInput.mockReturnValue(null);

    await executeScheduleFromResponse('!schedule 意味不明', message, scheduler);

    expect(scheduler.add).not.toHaveBeenCalled();
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('should use channel.send instead of message.reply', async () => {
    const message = createMockMessage();
    const scheduler = createMockScheduler();
    mockParseScheduleInput.mockReturnValue({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'test',
    });

    await executeScheduleFromResponse('!schedule 毎日 9:00 test', message, scheduler);

    expect(message.channel.send).toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
  });
});
