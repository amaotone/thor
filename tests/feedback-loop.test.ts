import { beforeEach, describe, expect, it, vi } from 'vitest';

// handleDiscordCommandsInResponse をモック
vi.mock('../src/discord-commands.js', () => ({
  handleDiscordCommandsInResponse: vi.fn(),
}));

import { handleDiscordCommandsInResponse } from '../src/discord-commands.js';
import { executeCommandsWithFeedback } from '../src/feedback-loop.js';

const mockHandleCommands = vi.mocked(handleDiscordCommandsInResponse);

describe('executeCommandsWithFeedback', () => {
  const dummyClient = {} as Parameters<typeof executeCommandsWithFeedback>[1];
  const dummyScheduler = {} as Parameters<typeof executeCommandsWithFeedback>[2];

  beforeEach(() => {
    mockHandleCommands.mockReset();
  });

  it('should not call runAgent when no feedback results', async () => {
    mockHandleCommands.mockResolvedValueOnce([]);
    const runAgent = vi.fn();

    await executeCommandsWithFeedback('結果テキスト', dummyClient, dummyScheduler, {
      runAgent,
    });

    expect(mockHandleCommands).toHaveBeenCalledTimes(1);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('should call runAgent with feedback prompt when feedback exists', async () => {
    mockHandleCommands.mockResolvedValueOnce(['📺 チャンネル一覧:...']);
    mockHandleCommands.mockResolvedValueOnce([]); // 再注入後
    const runAgent = vi.fn().mockResolvedValue('再注入応答');

    await executeCommandsWithFeedback('結果テキスト', dummyClient, dummyScheduler, {
      runAgent,
    });

    expect(runAgent).toHaveBeenCalledTimes(1);
    const prompt = runAgent.mock.calls[0][0] as string;
    expect(prompt).toContain('コマンドの結果');
    expect(prompt).toContain('📺 チャンネル一覧:...');
  });

  it('should execute commands on re-injected response', async () => {
    mockHandleCommands.mockResolvedValueOnce(['フィードバック1']);
    mockHandleCommands.mockResolvedValueOnce([]); // 再注入後
    const runAgent = vi.fn().mockResolvedValue('再注入応答');

    await executeCommandsWithFeedback('結果テキスト', dummyClient, dummyScheduler, {
      runAgent,
    });

    // 2回呼ばれる: 1回目は元の応答、2回目は再注入後の応答
    expect(mockHandleCommands).toHaveBeenCalledTimes(2);
    expect(mockHandleCommands.mock.calls[1][0]).toBe('再注入応答');
  });

  it('should pass sourceMessage to handleDiscordCommandsInResponse', async () => {
    mockHandleCommands.mockResolvedValueOnce([]);
    const sourceMessage = { id: 'msg-1' } as Parameters<
      typeof executeCommandsWithFeedback
    >[3]['sourceMessage'];

    await executeCommandsWithFeedback('結果テキスト', dummyClient, dummyScheduler, {
      sourceMessage,
      runAgent: vi.fn(),
    });

    expect(mockHandleCommands.mock.calls[0][4]).toBe(sourceMessage);
  });

  it('should pass fallbackChannelId to handleDiscordCommandsInResponse', async () => {
    mockHandleCommands.mockResolvedValueOnce([]);

    await executeCommandsWithFeedback('結果テキスト', dummyClient, dummyScheduler, {
      fallbackChannelId: 'ch-123',
      runAgent: vi.fn(),
    });

    expect(mockHandleCommands.mock.calls[0][5]).toBe('ch-123');
  });

  it('should join multiple feedback results with newlines', async () => {
    mockHandleCommands.mockResolvedValueOnce(['結果1', '結果2']);
    mockHandleCommands.mockResolvedValueOnce([]);
    const runAgent = vi.fn().mockResolvedValue('');

    await executeCommandsWithFeedback('結果テキスト', dummyClient, dummyScheduler, {
      runAgent,
    });

    const prompt = runAgent.mock.calls[0][0] as string;
    expect(prompt).toContain('結果1');
    expect(prompt).toContain('結果2');
  });

  it('should not re-inject if runAgent returns empty', async () => {
    mockHandleCommands.mockResolvedValueOnce(['フィードバック']);
    mockHandleCommands.mockResolvedValueOnce([]);
    const runAgent = vi.fn().mockResolvedValue('');

    await executeCommandsWithFeedback('結果テキスト', dummyClient, dummyScheduler, {
      runAgent,
    });

    // runAgent returns empty but handleDiscordCommandsInResponse is still called
    expect(mockHandleCommands).toHaveBeenCalledTimes(2);
  });
});
