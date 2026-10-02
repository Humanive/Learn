import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

// Runs the built CLI in a child process with HOME pointed at a temp dir,
// so ~/.learn and ~/Learn never touch the real home directory.
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');

describe('learn CLI', () => {
  let home: string;

  const run = (args: string[], cwd = home) =>
    spawnSync('node', [CLI, ...args], {
      cwd,
      env: { ...process.env, HOME: home, FORCE_COLOR: '0' },
      encoding: 'utf-8',
    });

  const workspaceDir = (name: string) => path.join(home, 'Learn', name);

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe('new', () => {
    it('creates a workspace with resources.json and the global config', () => {
      const result = run(['new', 'browser-agents']);
      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(workspaceDir('browser-agents'), 'resources.json'))).toBe(true);
      expect(fs.existsSync(path.join(home, '.learn', 'config.yaml'))).toBe(true);

      // Verify old structure is NOT created
      expect(fs.existsSync(path.join(workspaceDir('browser-agents'), 'SOURCES.md'))).toBe(false);
      expect(fs.existsSync(path.join(workspaceDir('browser-agents'), '.learn'))).toBe(false);
    });

    it('fails when the workspace already exists', () => {
      run(['new', 'browser-agents']);
      const result = run(['new', 'browser-agents']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('already exists');
    });
  });

  describe('add', () => {
    it('fails when no workspace exists', () => {
      const result = run(['add', 'https://example.com']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('No workspace found');
    });

    it('adds to the only workspace with tags and records in resources.json', () => {
      run(['new', 'browser-agents']);
      const result = run(['add', 'https://github.com/browser-use/browser-use', '-t', 'python,automation']);
      expect(result.status).toBe(0);

      const resourcesFile = JSON.parse(
        fs.readFileSync(path.join(workspaceDir('browser-agents'), 'resources.json'), 'utf-8')
      );
      expect(resourcesFile.version).toBe(1);
      expect(resourcesFile.resources).toHaveLength(1);

      const entry = resourcesFile.resources[0];
      expect(entry.source).toBe('https://github.com/browser-use/browser-use');
      expect(entry.type).toBe('repos');
      expect(entry.status).toBe('pending');
      expect(entry.tags).toEqual(['python', 'automation']);
    });

    it('requires --workspace when several workspaces exist', () => {
      run(['new', 'a']);
      run(['new', 'b']);
      const result = run(['add', 'https://example.com']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Multiple workspaces found');
    });

    it('targets the workspace given by --workspace', () => {
      run(['new', 'a']);
      run(['new', 'b']);
      const result = run(['add', 'https://example.com/post', '-w', 'b']);
      expect(result.status).toBe(0);

      const resourcesFile = JSON.parse(
        fs.readFileSync(path.join(workspaceDir('b'), 'resources.json'), 'utf-8')
      );
      expect(resourcesFile.resources[0].source).toBe('https://example.com/post');
    });

    it('uses the current workspace when run inside one', () => {
      run(['new', 'a']);
      run(['new', 'b']);
      const result = run(['add', 'https://example.com/inside'], workspaceDir('a'));
      expect(result.status).toBe(0);

      const resourcesFile = JSON.parse(
        fs.readFileSync(path.join(workspaceDir('a'), 'resources.json'), 'utf-8')
      );
      expect(resourcesFile.resources[0].source).toBe('https://example.com/inside');
    });

    it('fails for an unknown --workspace', () => {
      run(['new', 'a']);
      const result = run(['add', 'https://example.com', '-w', 'missing']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('does not exist');
    });
  });

  describe('list', () => {
    it('reports when there are no workspaces', () => {
      const result = run(['list']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('No workspaces found');
    });

    it('lists workspaces with resource counts', () => {
      run(['new', 'browser-agents']);
      run(['add', 'https://example.com']);
      const result = run(['ls']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('browser-agents');
      expect(result.stdout).toContain('Resources: 1 (1 pending)');
    });
  });
});
