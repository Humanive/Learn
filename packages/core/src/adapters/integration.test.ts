import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gitAdapter, jinaAdapter, markitdownAdapter, localAdapter } from './index.js';
import { AdapterContext } from './types.js';
import { GlobalConfig } from '../types.js';
import { WorkspaceManager } from '../workspace.js';

describe('Adapter Integration', () => {
  let tempDir: string;
  let workspacePath: string;
  let config: GlobalConfig;
  let workspaceManager: WorkspaceManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-integration-test-'));
    workspaceManager = new WorkspaceManager(tempDir);

    config = {
      learnDir: tempDir,
      defaultGitDepth: 1,
      jinaApiKey: process.env.JINA_API_KEY || null,
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

  it('should ingest one resource of each type into workspace', async () => {
    // Create workspace with output folders
    workspacePath = await workspaceManager.create('test-workspace');

    // Test git adapter (repos)
    const gitContext: AdapterContext = {
      source: 'https://github.com/octocat/Hello-World',
      workspacePath,
      config,
    };

    const gitResult = await gitAdapter(gitContext);

    if (gitResult.success) {
      expect(gitResult.output).toBeDefined();
      expect(gitResult.output).toMatch(/^repos\//);
      const gitOutputPath = path.join(workspacePath, gitResult.output!);
      expect(fs.existsSync(gitOutputPath)).toBe(true);
    }

    // Test jina adapter (web) - skip if no API key
    if (config.jinaApiKey) {
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
    }

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
  }, 60000);

  it('should handle adapter failures gracefully', async () => {
    workspacePath = await workspaceManager.create('test-workspace');

    // Test with invalid source
    const invalidContext: AdapterContext = {
      source: 'https://this-definitely-does-not-exist-12345.com',
      workspacePath,
      config: { ...config, jinaApiKey: 'test-key' },
    };

    const result = await jinaAdapter(invalidContext);

    expect(result.success).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.output).toBeUndefined();
  }, 30000);

  it('should maintain workspace integrity after failed ingests', async () => {
    workspacePath = await workspaceManager.create('test-workspace');

    // Try to clone a non-existent repo
    const gitContext: AdapterContext = {
      source: 'https://github.com/nonexistent-user-12345/nonexistent-repo-67890',
      workspacePath,
      config,
    };

    const gitResult = await gitAdapter(gitContext);

    expect(gitResult.success).toBe(false);

    // Verify repos directory is still clean (no partial clones)
    const reposDir = path.join(workspacePath, 'repos');
    const entries = fs.readdirSync(reposDir);
    expect(entries.length).toBe(0);
  }, 30000);
});
