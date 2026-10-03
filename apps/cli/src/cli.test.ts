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

    it('stores an optional title with the resource', () => {
      run(['new', 'browser-agents']);
      const result = run(['add', 'https://example.com/article', '--title', 'Article title']);

      expect(result.status).toBe(0);
      const resourcesFile = JSON.parse(
        fs.readFileSync(path.join(workspaceDir('browser-agents'), 'resources.json'), 'utf-8')
      );
      expect(resourcesFile.resources[0].title).toBe('Article title');
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

    it('prints workspace names as JSON', () => {
      run(['new', 'browser-agents']);
      run(['new', 'papers']);

      const result = run(['list', '--json']);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(['browser-agents', 'papers']);
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

  describe('rm', () => {
    beforeEach(() => {
      run(['new', 'test-workspace']);
      run(['add', 'https://example.com', '-t', 'test']);
    });

    it('removes a resource from the workspace', () => {
      const result = run(['rm', 'https://example.com']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Resource removed');

      const resourcesFile = JSON.parse(
        fs.readFileSync(path.join(workspaceDir('test-workspace'), 'resources.json'), 'utf-8')
      );
      expect(resourcesFile.resources).toHaveLength(0);
    });

    it('fails when the resource does not exist', () => {
      const result = run(['rm', 'https://nonexistent.com']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('keeps the output file by default', () => {
      // Manually add a resource with output
      const resourcesPath = path.join(workspaceDir('test-workspace'), 'resources.json');
      const resourcesData = JSON.parse(fs.readFileSync(resourcesPath, 'utf-8'));
      resourcesData.resources[0].output = 'web/example.md';
      resourcesData.resources[0].status = 'ingested';
      fs.writeFileSync(resourcesPath, JSON.stringify(resourcesData, null, 2));

      // Create the output file
      const outputDir = path.join(workspaceDir('test-workspace'), 'web');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'example.md'), '# Example');

      const result = run(['rm', 'https://example.com']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Output kept');
      expect(fs.existsSync(path.join(outputDir, 'example.md'))).toBe(true);
    });

    it('deletes the output file with --purge', () => {
      // Manually add a resource with output
      const resourcesPath = path.join(workspaceDir('test-workspace'), 'resources.json');
      const resourcesData = JSON.parse(fs.readFileSync(resourcesPath, 'utf-8'));
      resourcesData.resources[0].output = 'web/example.md';
      resourcesData.resources[0].status = 'ingested';
      fs.writeFileSync(resourcesPath, JSON.stringify(resourcesData, null, 2));

      // Create the output file
      const outputDir = path.join(workspaceDir('test-workspace'), 'web');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'example.md'), '# Example');

      const result = run(['rm', 'https://example.com', '--purge']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Deleted file');
      expect(fs.existsSync(path.join(outputDir, 'example.md'))).toBe(false);
    });

    it('deletes output directory with --purge', () => {
      // Manually add a resource with output directory
      const resourcesPath = path.join(workspaceDir('test-workspace'), 'resources.json');
      const resourcesData = JSON.parse(fs.readFileSync(resourcesPath, 'utf-8'));
      resourcesData.resources[0].output = 'repos/test-repo';
      resourcesData.resources[0].status = 'ingested';
      fs.writeFileSync(resourcesPath, JSON.stringify(resourcesData, null, 2));

      // Create the output directory
      const outputDir = path.join(workspaceDir('test-workspace'), 'repos', 'test-repo');
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'README.md'), '# Test Repo');

      const result = run(['rm', 'https://example.com', '--purge']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Deleted directory');
      expect(fs.existsSync(outputDir)).toBe(false);
    });

    it('requires --workspace when multiple workspaces exist', () => {
      run(['new', 'workspace2']);
      const result = run(['rm', 'https://example.com']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Multiple workspaces found');
    });
  });

  describe('tag', () => {
    beforeEach(() => {
      run(['new', 'test-workspace']);
      run(['add', 'https://example.com', '-t', 'initial']);
    });

    it('adds tags to a resource', () => {
      const result = run(['tag', 'https://example.com', '+new1', '+new2']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Tags updated');
      expect(result.stdout).toContain('Added');

      const resourcesFile = JSON.parse(
        fs.readFileSync(path.join(workspaceDir('test-workspace'), 'resources.json'), 'utf-8')
      );
      expect(resourcesFile.resources[0].tags).toEqual(['initial', 'new1', 'new2']);
    });

    it('removes tags from a resource', () => {
      // Add more tags first
      run(['tag', 'https://example.com', '+tag2', '+tag3']);

      const result = run(['tag', 'https://example.com', '-tag2']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Removed');

      const resourcesFile = JSON.parse(
        fs.readFileSync(path.join(workspaceDir('test-workspace'), 'resources.json'), 'utf-8')
      );
      expect(resourcesFile.resources[0].tags).toEqual(['initial', 'tag3']);
    });

    it('adds and removes tags in the same operation', () => {
      const result = run(['tag', 'https://example.com', '+new', '-initial']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Added');
      expect(result.stdout).toContain('Removed');

      const resourcesFile = JSON.parse(
        fs.readFileSync(path.join(workspaceDir('test-workspace'), 'resources.json'), 'utf-8')
      );
      expect(resourcesFile.resources[0].tags).toEqual(['new']);
    });

    it('fails when the resource does not exist', () => {
      const result = run(['tag', 'https://nonexistent.com', '+tag']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('fails when no tag operations are provided', () => {
      const result = run(['tag', 'https://example.com']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('missing required argument');
    });

    it('fails when tag spec is invalid', () => {
      const result = run(['tag', 'https://example.com', 'invalid']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Invalid tag spec');
    });

    it('requires --workspace when multiple workspaces exist', () => {
      run(['new', 'workspace2']);
      const result = run(['tag', 'https://example.com', '+tag']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Multiple workspaces found');
    });
  });
});
