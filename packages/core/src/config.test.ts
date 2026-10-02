import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from './config.js';

describe('ConfigManager', () => {
  let testDir: string;
  let configDir: string;
  let configManager: ConfigManager;

  beforeEach(() => {
    // Isolated temp dir; never touch the real ~/.learn
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-config-test-'));
    configDir = path.join(testDir, '.learn');
    configManager = new ConfigManager(configDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should initialize config directory', async () => {
    await configManager.init();
    expect(fs.existsSync(configDir)).toBe(true);
  });

  it('should create default config file', async () => {
    await configManager.init();
    expect(fs.existsSync(path.join(configDir, 'config.yaml'))).toBe(true);
  });

  it('should load default config', async () => {
    const config = await configManager.load();
    expect(config.learnDir).toBeDefined();
    expect(config.defaultGitDepth).toBe(1);
    expect(config.features.autoIngest).toBe(false);
  });

  it('should get and set config values', async () => {
    await configManager.set('defaultGitDepth', null);
    expect(await configManager.get('defaultGitDepth')).toBe(null);
  });

  it('should persist values across instances', async () => {
    await configManager.set('defaultGitDepth', null);
    const fresh = new ConfigManager(configDir);
    expect(await fresh.get('defaultGitDepth')).toBe(null);
  });

  it('should expand tilde in learnDir', async () => {
    await configManager.set('learnDir', '~/Learn');
    const learnDir = await configManager.getLearnDir();
    expect(learnDir).not.toContain('~');
    expect(path.isAbsolute(learnDir)).toBe(true);
  });

  it('should reset to defaults', async () => {
    await configManager.set('defaultGitDepth', 5);
    await configManager.reset();
    expect(await configManager.get('defaultGitDepth')).toBe(1);
  });
});
