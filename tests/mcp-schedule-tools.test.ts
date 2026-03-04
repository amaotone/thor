import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunContext } from '../src/mcp/context.js';

// Mock the SDK tool function to just return the handler
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (_name: string, _desc: string, _schema: any, handler: any) => ({
    name: _name,
    handler,
  }),
}));

import { createScheduleTools } from '../src/mcp/schedule-tools.js';

function createMockScheduler() {
  return {
    add: vi.fn().mockReturnValue({
      id: 'sch-1',
      type: 'cron',
      expression: '0 9 * * *',
      message: 'test',
      enabled: true,
    }),
    list: vi.fn().mockReturnValue([]),
    remove: vi.fn(),
    toggle: vi.fn(),
  } as any;
}

describe('MCP Schedule Tools', () => {
  let scheduler: any;
  let runContext: RunContext;
  let tools: Record<string, { handler: (args: any) => Promise<any> }>;

  beforeEach(() => {
    scheduler = createMockScheduler();
    runContext = new RunContext();
    runContext.set({ channelId: 'ch-1' });
    const toolArray = createScheduleTools(scheduler, runContext);
    tools = {};
    for (const t of toolArray) {
      tools[(t as any).name] = t as any;
    }
  });

  describe('schedule_create', () => {
    it('should create a schedule from valid input', async () => {
      const result = await tools.schedule_create.handler({
        input: '毎日 9:00 good morning',
      });

      expect(scheduler.add).toHaveBeenCalled();
      expect(result.content[0].text).toContain('Schedule created');
      expect(result.content[0].text).toContain('sch-1');
    });

    it('should return error for invalid input', async () => {
      const result = await tools.schedule_create.handler({
        input: '???',
      });

      expect(result.content[0].text).toContain('Error');
      expect(scheduler.add).not.toHaveBeenCalled();
    });
  });

  describe('schedule_list', () => {
    it('should list schedules', async () => {
      scheduler.list.mockReturnValue([]);

      const result = await tools.schedule_list.handler({});

      expect(result.content[0].text).toBeDefined();
    });

    it('should handle errors', async () => {
      scheduler.list.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await tools.schedule_list.handler({});

      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('schedule_remove', () => {
    it('should remove existing schedule', async () => {
      scheduler.remove.mockReturnValue(true);

      const result = await tools.schedule_remove.handler({ id: 'sch-1' });

      expect(result.content[0].text).toContain('removed');
    });

    it('should return error for non-existing schedule', async () => {
      scheduler.remove.mockReturnValue(false);

      const result = await tools.schedule_remove.handler({ id: 'nope' });

      expect(result.content[0].text).toContain('not found');
    });

    it('should handle errors', async () => {
      scheduler.remove.mockImplementation(() => {
        throw new Error('fail');
      });

      const result = await tools.schedule_remove.handler({ id: 'sch-1' });

      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('schedule_toggle', () => {
    it('should toggle schedule to disabled', async () => {
      scheduler.toggle.mockReturnValue({ id: 'sch-1', enabled: false });

      const result = await tools.schedule_toggle.handler({ id: 'sch-1' });

      expect(result.content[0].text).toContain('disabled');
    });

    it('should toggle schedule to enabled', async () => {
      scheduler.toggle.mockReturnValue({ id: 'sch-1', enabled: true });

      const result = await tools.schedule_toggle.handler({ id: 'sch-1' });

      expect(result.content[0].text).toContain('enabled');
    });

    it('should return error for non-existing schedule', async () => {
      scheduler.toggle.mockReturnValue(null);

      const result = await tools.schedule_toggle.handler({ id: 'nope' });

      expect(result.content[0].text).toContain('not found');
    });

    it('should handle errors', async () => {
      scheduler.toggle.mockImplementation(() => {
        throw new Error('fail');
      });

      const result = await tools.schedule_toggle.handler({ id: 'sch-1' });

      expect(result.content[0].text).toContain('Error');
    });
  });
});
