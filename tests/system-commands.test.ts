import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { handleSystemCommand } from '../src/core/shared/system-commands.js';

describe('handleSystemCommand', () => {
  let exitSpy: ReturnType<typeof spyOn>;
  const mockLoadSettings = mock().mockReturnValue({ autoRestart: true });

  beforeEach(() => {
    jest.useFakeTimers();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    mockLoadSettings.mockReturnValue({ autoRestart: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    exitSpy.mockRestore();
  });

  it('should do nothing when no SYSTEM_COMMAND found', () => {
    handleSystemCommand('just regular text', undefined, { loadSettings: mockLoadSettings });
    jest.advanceTimersByTime(2000);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should trigger restart when autoRestart is enabled', () => {
    handleSystemCommand('some text\nSYSTEM_COMMAND:restart\nmore text', undefined, {
      loadSettings: mockLoadSettings,
    });
    expect(exitSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should not restart when autoRestart is disabled', () => {
    mockLoadSettings.mockReturnValue({ autoRestart: false });
    handleSystemCommand('SYSTEM_COMMAND:restart', undefined, { loadSettings: mockLoadSettings });
    jest.advanceTimersByTime(2000);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should ignore unknown commands', () => {
    handleSystemCommand('SYSTEM_COMMAND:unknown_action', undefined, {
      loadSettings: mockLoadSettings,
    });
    jest.advanceTimersByTime(2000);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should reject all SYSTEM_COMMANDs when platform is twitter', () => {
    handleSystemCommand('SYSTEM_COMMAND:restart', 'twitter', { loadSettings: mockLoadSettings });
    jest.advanceTimersByTime(2000);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should allow SYSTEM_COMMANDs when platform is discord', () => {
    handleSystemCommand('SYSTEM_COMMAND:restart', 'discord', { loadSettings: mockLoadSettings });
    jest.advanceTimersByTime(1000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
