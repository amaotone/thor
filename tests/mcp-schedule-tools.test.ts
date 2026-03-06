import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { RunContext, type ToolDefinition } from '../src/core/mcp/index.js';
import { createScheduleTools } from '../src/extensions/scheduler/index.js';

type MockScheduler = {
  add: ReturnType<typeof mock>;
  list: ReturnType<typeof mock>;
  remove: ReturnType<typeof mock>;
  toggle: ReturnType<typeof mock>;
};

function createMockScheduler(): MockScheduler {
  return {
    add: mock().mockReturnValue({
      id: 'sch-1',
      type: 'cron',
      expression: '0 9 * * *',
      message: 'test',
      enabled: true,
    }),
    list: mock().mockReturnValue([]),
    remove: mock(),
    toggle: mock(),
  };
}

describe('MCP Schedule Tools', () => {
  let scheduler: MockScheduler;
  let runContext: RunContext;
  let tools: Record<string, ToolDefinition>;

  beforeEach(() => {
    scheduler = createMockScheduler();
    runContext = new RunContext();
    runContext.set({ channelId: 'ch-1' });
    const toolArray = createScheduleTools(scheduler, runContext);
    tools = {};
    for (const t of toolArray) {
      tools[t.name] = t;
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
