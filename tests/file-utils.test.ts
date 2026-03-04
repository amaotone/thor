import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test';
import fs from 'node:fs';
import { downloadFile, extractFilePaths, isPathWithinDir } from '../src/core/shared/file-utils.js';

describe('isPathWithinDir', () => {
  it('should return true for paths inside the directory', () => {
    expect(isPathWithinDir('/workspace/project/file.png', '/workspace/project')).toBe(true);
    expect(isPathWithinDir('/workspace/project/sub/file.png', '/workspace/project')).toBe(true);
  });

  it('should return false for paths outside the directory', () => {
    expect(isPathWithinDir('/etc/shadow', '/workspace/project')).toBe(false);
    expect(isPathWithinDir('/home/user/.env', '/workspace/project')).toBe(false);
  });

  it('should prevent directory traversal', () => {
    expect(isPathWithinDir('/workspace/project/../../../etc/passwd', '/workspace/project')).toBe(
      false
    );
    expect(isPathWithinDir('/workspace/project/../../secret', '/workspace/project')).toBe(false);
  });

  it('should reject sibling directories with similar prefix', () => {
    expect(isPathWithinDir('/workspace/project-evil/file.png', '/workspace/project')).toBe(false);
  });

  it('should return true for the directory itself', () => {
    expect(isPathWithinDir('/workspace/project', '/workspace/project')).toBe(true);
  });
});

describe('extractFilePaths', () => {
  const workdir = '/workspace/project';

  beforeEach(() => {
    spyOn(fs, 'existsSync').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should extract MEDIA: paths within workdir', () => {
    const text = 'MEDIA: /workspace/project/output/image.png';
    const paths = extractFilePaths(text, workdir);
    expect(paths).toEqual(['/workspace/project/output/image.png']);
  });

  it('should reject MEDIA: paths outside workdir', () => {
    const text = 'MEDIA: /etc/shadow';
    const paths = extractFilePaths(text, workdir);
    expect(paths).toEqual([]);
  });

  it('should extract absolute paths with allowed extensions within workdir', () => {
    const text = 'Here is the file: /workspace/project/result.pdf';
    const paths = extractFilePaths(text, workdir);
    expect(paths).toEqual(['/workspace/project/result.pdf']);
  });

  it('should reject absolute paths outside workdir', () => {
    const text = 'Here is /home/user/private/key.pdf';
    const paths = extractFilePaths(text, workdir);
    expect(paths).toEqual([]);
  });

  it('should reject directory traversal in MEDIA:', () => {
    const text = 'MEDIA: /workspace/project/../../etc/passwd';
    const paths = extractFilePaths(text, workdir);
    expect(paths).toEqual([]);
  });

  it('should handle mixed valid and invalid paths', () => {
    const text = `MEDIA: /workspace/project/ok.png
MEDIA: /etc/shadow
Here /workspace/project/sub/image.jpg and /tmp/secret.pdf`;
    const paths = extractFilePaths(text, workdir);
    expect(paths).toEqual(['/workspace/project/ok.png', '/workspace/project/sub/image.jpg']);
  });
});

describe('downloadFile', () => {
  it('should reject non-Discord URLs', async () => {
    await expect(downloadFile('http://localhost:9090/metrics', 'file.txt')).rejects.toThrow(
      "Download blocked: host 'localhost' is not allowed"
    );
  });

  it('should reject internal network URLs', async () => {
    await expect(
      downloadFile('http://169.254.169.254/latest/meta-data/', 'meta.txt')
    ).rejects.toThrow('is not allowed');
  });

  it('should reject arbitrary external URLs', async () => {
    await expect(downloadFile('https://evil.com/steal', 'data.txt')).rejects.toThrow(
      'is not allowed'
    );
  });

  it('should allow cdn.discordapp.com', async () => {
    // fetchがネットワークエラーを出すが、URLバリデーションは通る
    const result = downloadFile(
      'https://cdn.discordapp.com/attachments/123/456/file.png',
      'file.png'
    );
    // URL検証は通るが、実際のfetchは失敗する（ネットワーク未接続）ので、
    // "is not allowed" エラーではないことを確認
    await expect(result).rejects.not.toThrow('is not allowed');
  });

  it('should allow media.discordapp.net', async () => {
    const result = downloadFile(
      'https://media.discordapp.net/attachments/123/456/file.png',
      'file.png'
    );
    await expect(result).rejects.not.toThrow('is not allowed');
  });
});
