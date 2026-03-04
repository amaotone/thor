import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTypeLabel } from '../src/scheduler/schedule-handler.js';

// --- Mock dependencies ---
vi.mock('../src/scheduler/scheduler.js', () => ({
  parseScheduleInput: vi.fn(),
  formatScheduleList: vi.fn().mockReturnValue('📋 スケジュールはありません'),
  SCHEDULE_SEPARATOR: '{{SPLIT}}',
}));

import { handleScheduleCommand } from '../src/scheduler/schedule-handler.js';
import { formatScheduleList, parseScheduleInput } from '../src/scheduler/scheduler.js';

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
