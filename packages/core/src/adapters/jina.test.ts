import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { jinaAdapter } from './jina.js';
import { AdapterContext } from './types.js';
import { GlobalConfig } from '../types.js';

interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

describe('jinaAdapter', () => {
  let tempDir: string;
  let workspacePath: string;
  let webDir: string;
  let config: GlobalConfig;
  let originalFetch: typeof globalThis.fetch;

  /**
   * Replace the Jina Reader call with a stub so no test touches the network.
   * Returns the recorded calls so headers can be asserted.
   */
  function stubReader(response: () => Response): FetchCall[] {
    const calls: FetchCall[] = [];
    const mock = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: { ...((init?.headers as Record<string, string>) || {}) },
      });
      return response();
    });
    globalThis.fetch = mock as unknown as typeof globalThis.fetch;
    return calls;
  }

  function markdown(body: string): Response {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/markdown' } });
  }

  function run(source: string, overrides: Partial<GlobalConfig> = {}): ReturnType<typeof jinaAdapter> {
    const context: AdapterContext = {
      source,
      workspacePath,
      config: { ...config, ...overrides },
    };
    return jinaAdapter(context);
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-jina-test-'));
    workspacePath = path.join(tempDir, 'workspace');
    webDir = path.join(workspacePath, 'web');
    fs.mkdirSync(webDir, { recursive: true });

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

  it('should write markdown to web/ using free-tier headers', async () => {
    const calls = stubReader(() => markdown('# Example Domain\n\nBody text.'));

    const result = await run('https://example.com');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://r.jina.ai/https://example.com');
    // Free tier: markdown is requested, but no credentials are sent
    expect(calls[0].headers['X-Return-Format']).toBe('markdown');
    expect(calls[0].headers['Authorization']).toBeUndefined();

    expect(result.success).toBe(true);
    expect(result.output).toBe('web/example.md');

    const outputPath = path.join(workspacePath, result.output!);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe('# Example Domain\n\nBody text.');
  });

  it('should send the configured API key as a bearer token', async () => {
    const calls = stubReader(() => markdown('# Paid tier'));

    const result = await run('https://example.com', { jinaApiKey: 'test-key' });

    expect(calls[0].headers['Authorization']).toBe('Bearer test-key');
    expect(calls[0].headers['X-Return-Format']).toBe('markdown');
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, result.output!))).toBe(true);
  });

  it('should sanitize filename from URL', async () => {
    stubReader(() => markdown('# My article'));

    const result = await run('https://example.com/my-article?query=1#section');

    expect(result.success).toBe(true);
    expect(result.output).toBe('web/my-article.md');
  });

  it('should use only the last path segment, sanitized', async () => {
    stubReader(() => markdown('# Report'));

    const result = await run('https://example.com/docs/2024 Q1/report.html');

    expect(result.success).toBe(true);
    expect(result.output).toBe('web/report.md');

    const spaced = await run('https://example.com/docs/2024:Q1.html');
    expect(spaced.output).toBe('web/2024-Q1.md');

    // Percent-encoded input is sanitized too, not decoded
    const encoded = await run('https://example.com/docs/2024 Q1.html');
    expect(encoded.output).toBe('web/2024-20Q1.md');
  });

  it('should handle duplicate filenames', async () => {
    stubReader(() => markdown('# Fresh content'));
    fs.writeFileSync(path.join(webDir, 'example.md'), 'existing content');

    const result = await run('https://example.com');

    expect(result.success).toBe(true);
    expect(result.output).toBe('web/example-2.md');
    // The pre-existing file is left untouched
    expect(fs.readFileSync(path.join(webDir, 'example.md'), 'utf-8')).toBe('existing content');
    expect(fs.readFileSync(path.join(webDir, 'example-2.md'), 'utf-8')).toBe('# Fresh content');
  });

  it('should not write a file when the reader returns an HTTP error', async () => {
    stubReader(() => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }));

    const result = await run('https://example.com');

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.reason).toBe('Jina API error: 429 Too Many Requests');
    expect(fs.readdirSync(webDir)).toEqual([]);
  });

  it('should handle a rejected fetch', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof globalThis.fetch;

    const result = await run('https://example.com');

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.reason).toBe('Failed to fetch webpage: network unreachable');
    expect(fs.readdirSync(webDir)).toEqual([]);
  });

  it('should handle invalid URLs without calling the reader', async () => {
    const calls = stubReader(() => markdown('# Never used'));

    const result = await run('not-a-valid-url');

    expect(result.success).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.reason).toBe('Invalid URL');
    expect(calls).toEqual([]);
  });
});
