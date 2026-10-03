import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ingestWorkspace, IngestResult, IngestConfig } from './orchestrator.js';
import { ResourcesManager } from '../resources.js';
import { ResourcesFile } from '../types.js';

describe('ingestWorkspace', () => {
  let testWorkspace: string;
  let testConfig: IngestConfig;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Create temporary workspace
    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-test-'));

    // Create output directories
    fs.mkdirSync(path.join(testWorkspace, 'web'));
    fs.mkdirSync(path.join(testWorkspace, 'pdf'));
    fs.mkdirSync(path.join(testWorkspace, 'repos'));
    fs.mkdirSync(path.join(testWorkspace, 'local'));
    fs.mkdirSync(path.join(testWorkspace, 'video'));

    // Create resources.json
    ResourcesManager.initialize(testWorkspace);

    // Default test config
    testConfig = {
      adapterChains: {
        web: ['jina'],
        pdf: ['markitdown'],
        repos: ['git'],
        local: ['local'],
        video: [],
      },
      concurrency: 3,
      agentTimeout: 300000, // 5 minutes
      globalConfig: {
        learnDir: path.join(os.homedir(), 'Learn'),
        defaultGitDepth: 1,
        jinaApiKey: null,
        editor: 'vim',
        features: {
          autoIngest: false,
          preserveProvenance: true,
        },
      },
    };

    // Keep web resources off the network: the jina adapter is the only adapter
    // in the chains above that calls fetch.
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network disabled in tests');
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    // Clean up
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  describe('basic orchestration', () => {
    it('should process pending resources', async () => {
      // Add a mock successful resource
      ResourcesManager.addResource(testWorkspace, 'test-source', 'web', []);

      const result = await ingestWorkspace(testWorkspace, testConfig);

      expect(result.success).toEqual(0);
      expect(result.failed).toEqual(1);
      expect(result.skipped).toEqual(0);
    });

    it('should skip non-pending resources', async () => {
      // Add a resource and manually mark it as ingested
      ResourcesManager.addResource(testWorkspace, 'test-source', 'web', []);
      const data = ResourcesManager.load(testWorkspace);
      data.resources[0].status = 'ingested';
      ResourcesManager.save(testWorkspace, data);

      const result = await ingestWorkspace(testWorkspace, testConfig);

      expect(result.success).toEqual(0);
      expect(result.failed).toEqual(0);
      expect(result.skipped).toEqual(1);
    });

    it('should return empty result when no resources exist', async () => {
      const result = await ingestWorkspace(testWorkspace, testConfig);

      expect(result.success).toEqual(0);
      expect(result.failed).toEqual(0);
      expect(result.skipped).toEqual(0);
    });
  });

  describe('adapter chain', () => {
    it('should try adapters in config order', async () => {
      // Mock a resource that will fail with first adapter but work with second
      ResourcesManager.addResource(testWorkspace, 'test-source', 'pdf', []);

      // Use a config with multiple adapters for pdf
      testConfig.adapterChains.pdf = ['markitdown']; // Will fail without actual file

      const result = await ingestWorkspace(testWorkspace, testConfig);

      expect(result.failed).toEqual(1);
    });

    it('should record which adapter succeeded', async () => {
      // Create a real local file to test with
      const testFile = path.join(testWorkspace, 'test.txt');
      fs.writeFileSync(testFile, 'test content');

      ResourcesManager.addResource(testWorkspace, testFile, 'local', []);

      const result = await ingestWorkspace(testWorkspace, testConfig);

      expect(result.success).toEqual(1);

      // Check that adapter name was recorded
      const data = ResourcesManager.load(testWorkspace);
      expect(data.resources[0].adapter).toEqual('local');
      expect(data.resources[0].status).toEqual('ingested');
    });

    it('should mark resource failed when all adapters fail', async () => {
      ResourcesManager.addResource(testWorkspace, 'https://nonexistent.example.com', 'web', []);

      const result = await ingestWorkspace(testWorkspace, testConfig);

      expect(result.failed).toEqual(1);

      const data = ResourcesManager.load(testWorkspace);
      expect(data.resources[0].status).toEqual('failed');
    });

    it('records the jina failure reason without reaching the network', async () => {
      ResourcesManager.addResource(testWorkspace, 'https://nonexistent.example.com', 'web', []);

      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        agentName: 'test-agent',
        agentRunner: async () => undefined,
      });

      expect(result.failed).toEqual(1);
      const manifest = fs.readFileSync(
        path.join(testWorkspace, '.learn', 'failed-resources.md'),
        'utf-8'
      );
      expect(manifest).toContain('jina: Failed to fetch webpage: network disabled in tests');
      expect(fs.readdirSync(path.join(testWorkspace, 'web'))).toEqual([]);
    });
  });

  describe('concurrency', () => {
    it('should process up to 3 resources concurrently', async () => {
      // Add 5 local files
      for (let i = 0; i < 5; i++) {
        const testFile = path.join(testWorkspace, `test${i}.txt`);
        fs.writeFileSync(testFile, `content ${i}`);
        ResourcesManager.addResource(testWorkspace, testFile, 'local', []);
      }

      const startTime = Date.now();
      const result = await ingestWorkspace(testWorkspace, testConfig);
      const duration = Date.now() - startTime;

      expect(result.success).toEqual(5);
      // Should complete quickly since symlinks are fast
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('agent handoff', () => {
    it('writes a manifest and records agent output as ingested', async () => {
      ResourcesManager.addResource(testWorkspace, 'video-123', 'video', ['course']);
      const runner = async ({ workspacePath, manifestPath, resources }: Parameters<NonNullable<IngestConfig['agentRunner']>>[0]) => {
        expect(fs.existsSync(manifestPath)).toBe(true);
        const manifest = fs.readFileSync(manifestPath, 'utf-8');
        expect(manifest).toContain('video-123');
        expect(manifest).toContain('video/video-123.md');
        fs.writeFileSync(path.join(workspacePath, resources[0].expectedOutput), '# Transcript');
      };

      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        agentName: 'test-agent',
        agentRunner: runner,
      });

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.handedOff).toBe(1);
      const data = ResourcesManager.load(testWorkspace);
      expect(data.resources[0]).toMatchObject({
        status: 'ingested',
        adapter: 'agent:test-agent',
        output: 'video/video-123.md',
      });
      expect(fs.existsSync(path.join(testWorkspace, '.learn', 'failed-resources.md'))).toBe(true);
    });

    it('assigns distinct outputs to URLs with the same pathname', async () => {
      const sources = ['https://www.youtube.com/watch?v=first', 'https://www.youtube.com/watch?v=second'];
      for (const source of sources) {
        ResourcesManager.addResource(testWorkspace, source, 'video', []);
      }

      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        agentRunner: async ({ workspacePath, resources }) => {
          expect(new Set(resources.map(resource => resource.expectedOutput)).size).toBe(2);
          for (const resource of resources) {
            fs.writeFileSync(path.join(workspacePath, resource.expectedOutput), resource.resource.source);
          }
        },
      });

      expect(result.success).toBe(2);
      const data = ResourcesManager.load(testWorkspace);
      expect(new Set(data.resources.map(resource => resource.output)).size).toBe(2);
      for (const resource of data.resources) {
        expect(fs.readFileSync(path.join(testWorkspace, resource.output!), 'utf-8')).toBe(resource.source);
      }
    });

    it('does not treat a pre-existing output as a new agent result', async () => {
      ResourcesManager.addResource(testWorkspace, 'https://www.youtube.com/watch?v=new', 'video', []);
      const existingPath = path.join(testWorkspace, 'video', 'watch.md');
      fs.writeFileSync(existingPath, '# Previous transcript');

      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        agentRunner: async () => undefined,
      });

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(ResourcesManager.load(testWorkspace).resources[0].status).toBe('failed');
      expect(fs.readFileSync(existingPath, 'utf-8')).toBe('# Previous transcript');
    });

    it('hands off previously failed resources when an agent is provided', async () => {
      ResourcesManager.addResource(testWorkspace, 'video-retry', 'video', []);
      await ingestWorkspace(testWorkspace, testConfig);
      expect(ResourcesManager.load(testWorkspace).resources[0].status).toBe('failed');

      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        agentRunner: async ({ workspacePath, resources }) => {
          fs.writeFileSync(path.join(workspacePath, resources[0].expectedOutput), '# Recovered transcript');
        },
      });

      expect(result.success).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.handedOff).toBe(1);
      expect(ResourcesManager.load(testWorkspace).resources[0].status).toBe('ingested');
    });

    it('includes an absolute input path for a local PDF handoff', async () => {
      const source = './paper.pdf';
      ResourcesManager.addResource(testWorkspace, source, 'pdf', []);
      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        adapterChains: { ...testConfig.adapterChains, pdf: [] },
        agentRunner: async ({ workspacePath, manifestPath, resources }) => {
          const manifest = fs.readFileSync(manifestPath, 'utf-8');
          expect(manifest).toContain(`- Input path: ${path.resolve(source)}`);
          fs.writeFileSync(path.join(workspacePath, resources[0].expectedOutput), '# Paper');
        },
      });
      expect(result.success).toBe(1);
    });

    it('rejects empty document files and empty repository directories', async () => {
      ResourcesManager.addResource(testWorkspace, 'video-empty', 'video', []);
      ResourcesManager.addResource(testWorkspace, 'https://github.com/example/empty', 'repos', []);
      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        adapterChains: { ...testConfig.adapterChains, repos: [] },
        agentRunner: async ({ workspacePath, resources }) => {
          for (const item of resources) {
            const output = path.join(workspacePath, item.expectedOutput);
            if (item.resource.type === 'repos') fs.mkdirSync(output);
            else fs.writeFileSync(output, '');
          }
        },
      });
      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
    });

    it('does not accept partial output when the agent exits with an error', async () => {
      ResourcesManager.addResource(testWorkspace, 'video-partial', 'video', []);
      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        agentRunner: async ({ workspacePath, resources }) => {
          fs.writeFileSync(path.join(workspacePath, resources[0].expectedOutput), '# Partial transcript');
          throw new Error('Agent exited before completing the output');
        },
      });
      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(ResourcesManager.load(testWorkspace).resources[0].status).toBe('failed');
    });

    it('cancels the agent and rejects partial output when it times out', async () => {
      ResourcesManager.addResource(testWorkspace, 'video-cancel', 'video', []);
      let cancelled = false;
      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        agentTimeout: 10,
        agentRunner: async (handoff) => {
          fs.writeFileSync(path.join(handoff.workspacePath, handoff.resources[0].expectedOutput), '# Partial');
          await new Promise<void>((resolve) => {
            handoff.signal?.addEventListener('abort', () => {
              cancelled = true;
              resolve();
            }, { once: true });
          });
        },
      });
      expect(cancelled).toBe(true);
      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(ResourcesManager.load(testWorkspace).resources[0].status).toBe('failed');
    });

    it('keeps the resource failed when the agent times out', async () => {
      ResourcesManager.addResource(testWorkspace, 'video-456', 'video', []);
      const result = await ingestWorkspace(testWorkspace, {
        ...testConfig,
        agentTimeout: 10,
        agentRunner: () => new Promise<void>(() => undefined),
      });

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.handedOff).toBe(0);
      expect(ResourcesManager.load(testWorkspace).resources[0].status).toBe('failed');
    });
  });

  describe('status updates', () => {
    it('should update status to ingested on success', async () => {
      const testFile = path.join(testWorkspace, 'test.txt');
      fs.writeFileSync(testFile, 'test content');
      ResourcesManager.addResource(testWorkspace, testFile, 'local', []);

      await ingestWorkspace(testWorkspace, testConfig);

      const data = ResourcesManager.load(testWorkspace);
      expect(data.resources[0].status).toEqual('ingested');
      expect(data.resources[0].output).toBeDefined();
      expect(data.resources[0].ingestedAt).toBeDefined();
    });

    it('should update status to failed when all adapters fail', async () => {
      ResourcesManager.addResource(testWorkspace, '/nonexistent/path', 'local', []);

      await ingestWorkspace(testWorkspace, testConfig);

      const data = ResourcesManager.load(testWorkspace);
      expect(data.resources[0].status).toEqual('failed');
      expect(data.resources[0].output).toBeUndefined();
    });
  });

  describe('timestamps', () => {
    it('should record ingestedAt timestamp on success', async () => {
      const testFile = path.join(testWorkspace, 'test.txt');
      fs.writeFileSync(testFile, 'test content');
      ResourcesManager.addResource(testWorkspace, testFile, 'local', []);

      const beforeIngest = new Date().toISOString();
      await ingestWorkspace(testWorkspace, testConfig);
      const afterIngest = new Date().toISOString();

      const data = ResourcesManager.load(testWorkspace);
      const ingestedAt = data.resources[0].ingestedAt!;

      expect(ingestedAt).toBeDefined();
      expect(ingestedAt >= beforeIngest).toBe(true);
      expect(ingestedAt <= afterIngest).toBe(true);
    });
  });
});

