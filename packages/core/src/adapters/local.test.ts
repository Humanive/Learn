import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { localAdapter } from './local.js';
import { AdapterContext } from './types.js';
import { GlobalConfig } from '../types.js';

describe('localAdapter', () => {
  let tempDir: string;
  let workspacePath: string;
  let sourcePath: string;
  let config: GlobalConfig;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-local-test-'));
    workspacePath = path.join(tempDir, 'workspace');
    sourcePath = path.join(tempDir, 'source');

    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'local'));
    fs.mkdirSync(sourcePath, { recursive: true });

    // Create a test file in the source
    fs.writeFileSync(path.join(sourcePath, 'test.txt'), 'test content');

    config = {
      learnDir: tempDir,
      defaultGitDepth: 1,
      jinaApiKey: null,
      editor: 'vim',
      features: {
        autoIngest: false,
        preserveProvenance: true,
      },
    };
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create a symlink successfully', async () => {
    const context: AdapterContext = {
      source: sourcePath,
      workspacePath,
      config,
    };

    const result = await localAdapter(context);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toContain('local/source');

    // Verify symlink exists
    const symlinkPath = path.join(workspacePath, result.output!);
    expect(fs.existsSync(symlinkPath)).toBe(true);
    expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);

    // Verify symlink points to correct location
    const linkTarget = fs.readlinkSync(symlinkPath);
    expect(linkTarget).toBe(sourcePath);
  });

  it('should handle non-existent source path', async () => {
    const context: AdapterContext = {
      source: path.join(tempDir, 'nonexistent'),
      workspacePath,
      config,
    };

    const result = await localAdapter(context);

    expect(result.success).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/not found|does not exist/i);
  });

  it('should handle unreadable source path', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const unreadablePath = path.join(tempDir, 'unreadable');
    fs.mkdirSync(unreadablePath, { recursive: true });

    try {
      fs.chmodSync(unreadablePath, 0o000);

      const context: AdapterContext = {
        source: unreadablePath,
        workspacePath,
        config,
      };

      const result = await localAdapter(context);

      expect(result.success).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toMatch(/permission|not readable/i);
    } finally {
      fs.chmodSync(unreadablePath, 0o755);
    }
  });

  it('should handle duplicate titles by appending suffix', async () => {
    const localDir = path.join(workspacePath, 'local');
    const existingLink = path.join(localDir, 'source');
    fs.symlinkSync(sourcePath, existingLink);

    const context: AdapterContext = {
      source: sourcePath,
      workspacePath,
      config,
    };

    const result = await localAdapter(context);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/local\/source-\d+/);

    const symlinkPath = path.join(workspacePath, result.output!);
    expect(fs.existsSync(symlinkPath)).toBe(true);
    expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
  });

  it('should handle multiple duplicates correctly', async () => {
    const localDir = path.join(workspacePath, 'local');
    fs.symlinkSync(sourcePath, path.join(localDir, 'source'));
    fs.symlinkSync(sourcePath, path.join(localDir, 'source-2'));

    const context: AdapterContext = {
      source: sourcePath,
      workspacePath,
      config,
    };

    const result = await localAdapter(context);

    expect(result.success).toBe(true);
    expect(result.output).toBe('local/source-3');
  });

  it('should extract basename from source path', async () => {
    const nestedSource = path.join(tempDir, 'parent', 'my-notes');
    fs.mkdirSync(nestedSource, { recursive: true });
    fs.writeFileSync(path.join(nestedSource, 'note.txt'), 'content');

    const context: AdapterContext = {
      source: nestedSource,
      workspacePath,
      config,
    };

    const result = await localAdapter(context);

    expect(result.success).toBe(true);
    expect(result.output).toBe('local/my-notes');
  });

  it('should resolve relative paths to absolute', async () => {
    const context: AdapterContext = {
      source: path.relative(process.cwd(), sourcePath),
      workspacePath,
      config,
    };

    const result = await localAdapter(context);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();

    const symlinkPath = path.join(workspacePath, result.output!);
    const linkTarget = fs.readlinkSync(symlinkPath);
    expect(path.isAbsolute(linkTarget)).toBe(true);
  });

  it('should work with files as well as directories', async () => {
    const filePath = path.join(tempDir, 'single-file.txt');
    fs.writeFileSync(filePath, 'file content');

    const context: AdapterContext = {
      source: filePath,
      workspacePath,
      config,
    };

    const result = await localAdapter(context);

    expect(result.success).toBe(true);
    expect(result.output).toBe('local/single-file.txt');

    const symlinkPath = path.join(workspacePath, result.output!);
    expect(fs.existsSync(symlinkPath)).toBe(true);
    expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
  });
});
