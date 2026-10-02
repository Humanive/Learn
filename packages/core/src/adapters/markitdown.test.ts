import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { markitdownAdapter } from './markitdown.js';
import { AdapterContext } from './types.js';
import { GlobalConfig } from '../types.js';

describe('markitdownAdapter', () => {
  let tempDir: string;
  let workspacePath: string;
  let config: GlobalConfig;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-markitdown-test-'));
    workspacePath = path.join(tempDir, 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'pdf'));

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

  it('should handle missing markitdown CLI', async () => {
    const pdfPath = path.join(tempDir, 'test.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\ntest content');

    const context: AdapterContext = {
      source: pdfPath,
      workspacePath,
      config,
    };

    // Mock PATH to exclude markitdown
    const originalPath = process.env.PATH;
    process.env.PATH = '';

    try {
      const result = await markitdownAdapter(context);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('markitdown');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('should handle missing source file', async () => {
    const context: AdapterContext = {
      source: '/nonexistent/file.pdf',
      workspacePath,
      config,
    };

    const result = await markitdownAdapter(context);

    expect(result.success).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('should convert PDF to markdown', async () => {
    // Create a minimal PDF file
    const pdfPath = path.join(tempDir, 'test.pdf');
    const pdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 12 Tf 100 700 Td (Hello World) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000214 00000 n
trailer << /Size 5 /Root 1 0 R >>
startxref
306
%%EOF`;
    fs.writeFileSync(pdfPath, pdfContent);

    const context: AdapterContext = {
      source: pdfPath,
      workspacePath,
      config,
    };

    const result = await markitdownAdapter(context);

    // This will fail if markitdown is not installed, which is expected in CI
    if (result.success) {
      expect(result.output).toBeDefined();
      expect(result.output).toMatch(/^pdf\/.+\.md$/);

      // Verify file was created
      const outputPath = path.join(workspacePath, result.output!);
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    } else {
      // If markitdown is not installed, expect proper error message
      expect(result.reason).toBeDefined();
    }
  }, 30000);

  it('should handle duplicate filenames', async () => {
    const pdfPath = path.join(tempDir, 'test.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\ntest content');

    const pdfDir = path.join(workspacePath, 'pdf');
    fs.writeFileSync(path.join(pdfDir, 'test.md'), 'existing content');

    const context: AdapterContext = {
      source: pdfPath,
      workspacePath,
      config,
    };

    const result = await markitdownAdapter(context);

    if (result.success) {
      expect(result.output).toMatch(/^pdf\/test-\d+\.md$/);
    }
  }, 30000);

  it('should sanitize output filename', async () => {
    const pdfPath = path.join(tempDir, 'My Document #1 (draft).pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\ntest content');

    const context: AdapterContext = {
      source: pdfPath,
      workspacePath,
      config,
    };

    const result = await markitdownAdapter(context);

    if (result.success) {
      expect(result.output).toMatch(/^pdf\/[a-zA-Z0-9-_]+\.md$/);
    }
  }, 30000);

  it('should handle URL sources for PDFs', async () => {
    const context: AdapterContext = {
      source: 'https://example.com/paper.pdf',
      workspacePath,
      config,
    };

    const result = await markitdownAdapter(context);

    // Should fail because we can't download in this adapter
    expect(result.success).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
