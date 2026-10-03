import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gitAdapter, jinaAdapter, markitdownAdapter, localAdapter } from './index.js';
import { AdapterContext } from './types.js';
import { GlobalConfig } from '../types.js';
import { WorkspaceManager } from '../workspace.js';

const liveTests = process.env.LEARN_LIVE_TESTS === '1';

describe('Adapter Integration', () => {
  let tempDir: string;
  let workspacePath: string;
  let sourcesDir: string;
  let config: GlobalConfig;
  let workspaceManager: WorkspaceManager;
  let originalFetch: typeof globalThis.fetch;

  /** Stub the Jina Reader call so the integration path stays offline. */
  function stubReader(response: () => Response): void {
    globalThis.fetch = vi.fn(async () => response()) as unknown as typeof globalThis.fetch;
  }

  function markdown(body: string): Response {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/markdown' } });
  }

  /** Create a local git repository cloned through file:// in the tests below. */
  function createRepository(repoPath: string): string {
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync('git', ['init', '--quiet', repoPath]);
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# local fixture\n');
    execFileSync('git', ['-C', repoPath, 'add', 'README.md']);
    execFileSync('git', [
      '-C', repoPath,
      '-c', 'user.name=Learn Test',
      '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'initial',
    ]);
    return repoPath;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-integration-test-'));
    workspaceManager = new WorkspaceManager(tempDir);
    sourcesDir = path.join(tempDir, 'sources');
    fs.mkdirSync(sourcesDir, { recursive: true });

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

    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should ingest one resource of each type into workspace', async () => {
    // Create workspace with output folders
    workspacePath = await workspaceManager.create('test-workspace');

    // Test git adapter (repos)
    const localRepo = createRepository(path.join(sourcesDir, 'hello-world'));
    const gitContext: AdapterContext = {
      source: `file://${localRepo}`,
      workspacePath,
      config,
    };

    const gitResult = await gitAdapter(gitContext);

    expect(gitResult.success).toBe(true);
    expect(gitResult.output).toBeDefined();
    expect(gitResult.output).toMatch(/^repos\//);
    const gitOutputPath = path.join(workspacePath, gitResult.output!);
    expect(fs.existsSync(gitOutputPath)).toBe(true);
    expect(fs.existsSync(path.join(gitOutputPath, 'README.md'))).toBe(true);

    // Test jina adapter (web)
    stubReader(() => markdown('# Example Domain\n\nBody text.'));

    const jinaContext: AdapterContext = {
      source: 'https://example.com',
      workspacePath,
      config,
    };

    const jinaResult = await jinaAdapter(jinaContext);

    expect(jinaResult.success).toBe(true);
    expect(jinaResult.output).toBeDefined();
    expect(jinaResult.output).toMatch(/^web\/.+\.md$/);
    const jinaOutputPath = path.join(workspacePath, jinaResult.output!);
    expect(fs.existsSync(jinaOutputPath)).toBe(true);
    expect(fs.readFileSync(jinaOutputPath, 'utf-8')).toContain('Example Domain');

    // Test markitdown adapter (pdf)
    const pdfPath = path.join(tempDir, 'test.pdf');
    const pdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer << /Size 4 /Root 1 0 R >>
startxref
196
%%EOF`;
    fs.writeFileSync(pdfPath, pdfContent);

    const markitdownContext: AdapterContext = {
      source: pdfPath,
      workspacePath,
      config,
    };

    const markitdownResult = await markitdownAdapter(markitdownContext);

    // This may fail if markitdown is not installed
    if (markitdownResult.success) {
      expect(markitdownResult.output).toBeDefined();
      expect(markitdownResult.output).toMatch(/^pdf\/.+\.md$/);
      const pdfOutputPath = path.join(workspacePath, markitdownResult.output!);
      expect(fs.existsSync(pdfOutputPath)).toBe(true);
    } else {
      expect(markitdownResult.reason).toBeDefined();
    }

    // Test local adapter
    const localSourcePath = path.join(tempDir, 'my-notes');
    fs.mkdirSync(localSourcePath, { recursive: true });
    fs.writeFileSync(path.join(localSourcePath, 'note.txt'), 'test note content');

    const localContext: AdapterContext = {
      source: localSourcePath,
      workspacePath,
      config,
    };

    const localResult = await localAdapter(localContext);

    expect(localResult.success).toBe(true);
    expect(localResult.output).toBeDefined();
    expect(localResult.output).toMatch(/^local\/.+$/);
    const localOutputPath = path.join(workspacePath, localResult.output!);
    expect(fs.existsSync(localOutputPath)).toBe(true);
    expect(fs.lstatSync(localOutputPath).isSymbolicLink()).toBe(true);

    // Verify symlink points to the correct source
    const linkTarget = fs.readlinkSync(localOutputPath);
    expect(linkTarget).toBe(localSourcePath);

    // Verify original file is accessible through symlink
    const noteContent = fs.readFileSync(path.join(localOutputPath, 'note.txt'), 'utf-8');
    expect(noteContent).toBe('test note content');

    // Verify workspace structure
    expect(fs.existsSync(path.join(workspacePath, 'repos'))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'web'))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'pdf'))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'video'))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'local'))).toBe(true);
  }, 30000);

  it('should handle adapter failures gracefully', async () => {
    workspacePath = await workspaceManager.create('test-workspace');

    globalThis.fetch = vi.fn(async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof globalThis.fetch;

    const context: AdapterContext = {
      source: 'https://this-definitely-does-not-exist-12345.com',
      workspacePath,
      config: { ...config, jinaApiKey: 'test-key' },
    };

    const result = await jinaAdapter(context);

    expect(result.success).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.output).toBeUndefined();
  });

  it('should reject an invalid URL without contacting the reader', async () => {
    workspacePath = await workspaceManager.create('test-workspace');
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const result = await jinaAdapter({ source: 'not-a-url', workspacePath, config });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('Invalid URL');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should maintain workspace integrity after failed ingests', async () => {
    workspacePath = await workspaceManager.create('test-workspace');

    // Try to clone a repository that does not exist locally
    const gitContext: AdapterContext = {
      source: `file://${path.join(sourcesDir, 'nonexistent-user-12345', 'nonexistent-repo-67890')}`,
      workspacePath,
      config,
    };

    const gitResult = await gitAdapter(gitContext);

    expect(gitResult.success).toBe(false);

    // Verify repos directory is still clean (no partial clones)
    const reposDir = path.join(workspacePath, 'repos');
    const entries = fs.readdirSync(reposDir);
    expect(entries.length).toBe(0);
  });

  // Live checks against real services are opt-in: set LEARN_LIVE_TESTS=1 to run them.
  describe.skipIf(!liveTests)('live external services', () => {
    it('should clone a public GitHub repository', async () => {
      workspacePath = await workspaceManager.create('test-workspace');

      const result = await gitAdapter({
        source: 'https://github.com/octocat/Hello-World',
        workspacePath,
        config,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('repos/Hello-World');
    }, 30000);

    it('should read a live webpage through Jina Reader', async () => {
      workspacePath = await workspaceManager.create('test-workspace');

      const result = await jinaAdapter({
        source: 'https://example.com',
        workspacePath,
        config: { ...config, jinaApiKey: process.env.JINA_API_KEY || null },
      });

      expect(result.success).toBe(true);
      expect(result.output).toMatch(/^web\/.+\.md$/);
      expect(fs.readFileSync(path.join(workspacePath, result.output!), 'utf-8').length).toBeGreaterThan(0);
    }, 30000);
  });
});
