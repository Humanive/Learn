import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SourcesManager } from './sources.js';

describe('SourcesManager', () => {
  let testDir: string;
  let sourcesPath: string;
  let sourcesManager: SourcesManager;

  const sampleSourcesContent = `# Sources

## Inbox

- https://github.com/example/repo #github #test
- https://example.com/article #web

## Processing

## Done
`;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-sources-test-'));
    sourcesPath = path.join(testDir, 'SOURCES.md');
    fs.writeFileSync(sourcesPath, sampleSourcesContent);
    sourcesManager = new SourcesManager();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should parse SOURCES.md correctly', () => {
    const result = sourcesManager.parse(sourcesPath);

    expect(result.inbox).toHaveLength(2);
    expect(result.inbox[0].url).toBe('https://github.com/example/repo');
    expect(result.inbox[0].tags).toEqual(['github', 'test']);
    expect(result.inbox[1].url).toBe('https://example.com/article');
    expect(result.inbox[1].tags).toEqual(['web']);
  });

  it('should add entry to inbox', () => {
    sourcesManager.addEntry(
      sourcesPath,
      'https://new-url.com',
      ['new', 'test'],
      'inbox'
    );

    const result = sourcesManager.parse(sourcesPath);
    expect(result.inbox).toHaveLength(3);
    const newEntry = result.inbox.find((e) => e.url === 'https://new-url.com');
    expect(newEntry).toBeDefined();
    expect(newEntry?.tags).toEqual(['new', 'test']);
  });

  it('should move entry between sections', () => {
    sourcesManager.moveEntry(
      sourcesPath,
      'https://github.com/example/repo',
      'inbox',
      'done'
    );

    const result = sourcesManager.parse(sourcesPath);
    expect(result.inbox).toHaveLength(1);
    expect(result.done).toHaveLength(1);
    expect(result.done[0].url).toBe('https://github.com/example/repo');
  });

  it('should throw when moving non-existent entry', () => {
    expect(() => {
      sourcesManager.moveEntry(
        sourcesPath,
        'https://non-existent.com',
        'inbox',
        'done'
      );
    }).toThrow('not found');
  });
});
