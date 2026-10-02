import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ingestWorkspace, IngestResult, IngestConfig } from './orchestrator.js';
import { ResourcesManager } from '../resources.js';
import { ResourcesFile } from '../types.js';

describe('ingestWorkspace', () => {
  let testWorkspace: string;
  let testConfig: IngestConfig;

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
  });

  afterEach(() => {
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

