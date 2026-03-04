import { beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import {
  getTypeLabel,
  handleScheduleCommand,
  type ScheduleHandlerDeps,
} from '../src/extensions/discord/schedule-handler.js';

// --- Mock deps ---
const mockParseScheduleInput = mock();
const mockFormatScheduleList = mock().mockReturnValue('📋 スケジュールはありません');

const deps: ScheduleHandlerDeps = {
  parseScheduleInput: mockParseScheduleInput,
  formatScheduleList: mockFormatScheduleList,
};

// --- Test helpers ---
function createMockInteraction(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'ch-1',
    options: {
      getSubcommand: mock().mockReturnValue('list'),
      getString: mock().mockReturnValue(null),
    },
    reply: mock().mockResolvedValue(undefined),
    followUp: mock().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Parameters<typeof handleScheduleCommand>[0];
}

function createMockScheduler(schedules: Array<{ id: string; enabled?: boolean }> = []) {
  return {
    list: mock().mockReturnValue(schedules),
    add: mock().mockImplementation((s) => ({
      ...s,
      id: 'sch_new',
      createdAt: new Date().toISOString(),
      enabled: true,
    })),
    remove: mock().mockReturnValue(true),
    toggle: mock().mockImplementation((id) => {
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
    jest.clearAllMocks();
    mockFormatScheduleList.mockReturnValue('📋 スケジュールはありません');
  });

  it('should reply with schedule list for "list" subcommand', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof mock>).mockReturnValue('list');
    const scheduler = createMockScheduler();

    await handleScheduleCommand(interaction, scheduler, undefined, deps);

    expect(scheduler.list).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('should reply with error when add input is invalid', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof mock>).mockReturnValue('add');
    (interaction.options.getString as ReturnType<typeof mock>).mockReturnValue('invalid input');
    mockParseScheduleInput.mockReturnValue(null);
    const scheduler = createMockScheduler();

    await handleScheduleCommand(interaction, scheduler, undefined, deps);

    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0][0];
    expect(replyArg.content).toContain('❌');
    expect(replyArg.ephemeral).toBe(true);
  });

  it('should add schedule and reply with success for valid add input', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof mock>).mockReturnValue('add');
    (interaction.options.getString as ReturnType<typeof mock>).mockImplementation((key: string) =>
      key === 'input' ? '毎日 9:00 おはよう' : null
    );
    mockParseScheduleInput.mockReturnValue({
      type: 'cron',
      expression: '0 9 * * *',
      message: 'おはよう',
    });
    const scheduler = createMockScheduler();

    await handleScheduleCommand(interaction, scheduler, undefined, deps);

    expect(scheduler.add).toHaveBeenCalled();
    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(replyArg).toContain('✅');
    expect(replyArg).toContain('sch_new');
  });

  it('should remove schedule by id', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof mock>).mockReturnValue('remove');
    (interaction.options.getString as ReturnType<typeof mock>).mockReturnValue('sch_abc');
    const scheduler = createMockScheduler();

    await handleScheduleCommand(interaction, scheduler, undefined, deps);

    expect(scheduler.remove).toHaveBeenCalledWith('sch_abc');
    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(replyArg).toContain('🗑️');
  });

  it('should reply with error when remove id not found', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof mock>).mockReturnValue('remove');
    (interaction.options.getString as ReturnType<typeof mock>).mockReturnValue('sch_missing');
    const scheduler = createMockScheduler();
    (scheduler.remove as ReturnType<typeof mock>).mockReturnValue(false);

    await handleScheduleCommand(interaction, scheduler, undefined, deps);

    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(replyArg).toContain('❌');
  });

  it('should toggle schedule and reply with status', async () => {
    const interaction = createMockInteraction();
    (interaction.options.getSubcommand as ReturnType<typeof mock>).mockReturnValue('toggle');
    (interaction.options.getString as ReturnType<typeof mock>).mockReturnValue('sch_1');
    const scheduler = createMockScheduler([{ id: 'sch_1', enabled: true }]);

    await handleScheduleCommand(interaction, scheduler, undefined, deps);

    expect(scheduler.toggle).toHaveBeenCalledWith('sch_1');
    const replyArg = (interaction.reply as ReturnType<typeof mock>).mock.calls[0][0] as string;
    expect(replyArg).toContain('⏸️ 無効');
  });
});
