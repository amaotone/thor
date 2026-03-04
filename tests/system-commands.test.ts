import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock settings module
vi.mock('../src/lib/settings.js', () => ({
  loadSettings: vi.fn().mockReturnValue({ autoRestart: true }),
}));

import { loadSettings } from '../src/lib/settings.js';
import { handleSystemCommand } from '../src/lib/system-commands.js';

describe('handleSystemCommand', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
  });

  it('should do nothing when no SYSTEM_COMMAND found', () => {
    handleSystemCommand('just regular text');
    vi.advanceTimersByTime(2000);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should trigger restart when autoRestart is enabled', () => {
    handleSystemCommand('some text\nSYSTEM_COMMAND:restart\nmore text');
    expect(exitSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should not restart when autoRestart is disabled', () => {
    (loadSettings as ReturnType<typeof vi.fn>).mockReturnValue({ autoRestart: false });
    handleSystemCommand('SYSTEM_COMMAND:restart');
    vi.advanceTimersByTime(2000);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should ignore unknown commands', () => {
    handleSystemCommand('SYSTEM_COMMAND:unknown_action');
    vi.advanceTimersByTime(2000);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should reject all SYSTEM_COMMANDs when platform is twitter', () => {
    (loadSettings as ReturnType<typeof vi.fn>).mockReturnValue({ autoRestart: true });
    handleSystemCommand('SYSTEM_COMMAND:restart', 'twitter');
    vi.advanceTimersByTime(2000);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should allow SYSTEM_COMMANDs when platform is discord', () => {
    (loadSettings as ReturnType<typeof vi.fn>).mockReturnValue({ autoRestart: true });
    handleSystemCommand('SYSTEM_COMMAND:restart', 'discord');
    vi.advanceTimersByTime(1000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
