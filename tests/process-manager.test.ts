import { describe, it, expect, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import { processManager } from '../src/process-manager.js';

describe('processManager', () => {
  beforeEach(() => {
    // 全プロセスを停止
    processManager.stopAll();
  });

  it('should return false when stopping non-existent process', () => {
    const result = processManager.stop('non-existent-channel');
    expect(result).toBe(false);
  });

  it('should return false for isRunning on non-existent channel', () => {
    const result = processManager.isRunning('non-existent-channel');
    expect(result).toBe(false);
  });

  it('should register and track a process', () => {
    const proc = spawn('sleep', ['10']);
    processManager.register('test-channel', proc);

    expect(processManager.isRunning('test-channel')).toBe(true);

    // クリーンアップ
    processManager.stop('test-channel');
  });

  it('should stop a registered process', () => {
    const proc = spawn('sleep', ['10']);
    processManager.register('test-channel', proc);

    const result = processManager.stop('test-channel');
    expect(result).toBe(true);
    expect(processManager.isRunning('test-channel')).toBe(false);
  });

  it('should stop all processes', () => {
    const proc1 = spawn('sleep', ['10']);
    const proc2 = spawn('sleep', ['10']);

    processManager.register('channel-1', proc1);
    processManager.register('channel-2', proc2);

    processManager.stopAll();

    expect(processManager.isRunning('channel-1')).toBe(false);
    expect(processManager.isRunning('channel-2')).toBe(false);
  });

  it('should return pid for a running process', () => {
    const proc = spawn('sleep', ['10']);
    processManager.register('test-channel', proc);

    expect(processManager.getPid('test-channel')).toBe(proc.pid);

    processManager.stop('test-channel');
  });

  it('should list running channels', () => {
    const proc1 = spawn('sleep', ['10']);
    const proc2 = spawn('sleep', ['10']);
    processManager.register('channel-1', proc1);
    processManager.register('channel-2', proc2);

    const channels = processManager.getRunningChannels();
    expect(channels).toContain('channel-1');
    expect(channels).toContain('channel-2');

    processManager.stopAll();
  });
});
