import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ResourcesManager } from './resources.js';
import { ResourcesFile } from './types.js';

describe('ResourcesManager', () => {
  let testDir: string;
  let workspacePath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-resources-test-'));
    workspacePath = path.join(testDir, 'test-workspace');
    fs.mkdirSync(workspacePath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create resources.json with version 1 and empty resources array', () => {
      ResourcesManager.initialize(workspacePath);

      const resourcesPath = path.join(workspacePath, 'resources.json');
      expect(fs.existsSync(resourcesPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(resourcesPath, 'utf-8'));
      expect(content).toEqual({
        version: 1,
        resources: [],
      });
    });
  });

  describe('load', () => {
    it('should load valid resources.json', () => {
      ResourcesManager.initialize(workspacePath);
      const data = ResourcesManager.load(workspacePath);

      expect(data.version).toBe(1);
      expect(data.resources).toEqual([]);
    });

    it('should throw if resources.json does not exist', () => {
      expect(() => ResourcesManager.load(workspacePath)).toThrow(
        'resources.json not found'
      );
    });

    it('should throw if resources.json contains invalid JSON', () => {
      const resourcesPath = path.join(workspacePath, 'resources.json');
      fs.writeFileSync(resourcesPath, '{ invalid json }');

      expect(() => ResourcesManager.load(workspacePath)).toThrow(
        'resources.json contains invalid JSON'
      );
    });

    it('should throw if resources.json has invalid structure - missing version', () => {
      const resourcesPath = path.join(workspacePath, 'resources.json');
      fs.writeFileSync(
        resourcesPath,
        JSON.stringify({ resources: [] })
      );

      expect(() => ResourcesManager.load(workspacePath)).toThrow(
        'resources.json has invalid structure'
      );
    });

    it('should throw if resources.json has invalid structure - resources not array', () => {
      const resourcesPath = path.join(workspacePath, 'resources.json');
      fs.writeFileSync(
        resourcesPath,
        JSON.stringify({ version: 1, resources: {} })
      );

      expect(() => ResourcesManager.load(workspacePath)).toThrow(
        'resources.json has invalid structure'
      );
    });

    it('should throw if resource entry has invalid type', () => {
      const resourcesPath = path.join(workspacePath, 'resources.json');
      const invalidData = {
        version: 1,
        resources: [
          {
            source: 'https://example.com',
            type: 'invalid_type',
            tags: [],
            status: 'pending',
          },
        ],
      };
      fs.writeFileSync(resourcesPath, JSON.stringify(invalidData));

      expect(() => ResourcesManager.load(workspacePath)).toThrow(
        'resources.json has invalid structure'
      );
    });

    it('should throw if resource entry has invalid status', () => {
      const resourcesPath = path.join(workspacePath, 'resources.json');
      const invalidData = {
        version: 1,
        resources: [
          {
            source: 'https://example.com',
            type: 'web',
            tags: [],
            status: 'invalid_status',
          },
        ],
      };
      fs.writeFileSync(resourcesPath, JSON.stringify(invalidData));

      expect(() => ResourcesManager.load(workspacePath)).toThrow(
        'resources.json has invalid structure'
      );
    });

    it('should throw if tags is not an array', () => {
      const resourcesPath = path.join(workspacePath, 'resources.json');
      const invalidData = {
        version: 1,
        resources: [
          {
            source: 'https://example.com',
            type: 'web',
            tags: 'not-an-array',
            status: 'pending',
          },
        ],
      };
      fs.writeFileSync(resourcesPath, JSON.stringify(invalidData));

      expect(() => ResourcesManager.load(workspacePath)).toThrow(
        'resources.json has invalid structure'
      );
    });
  });

  describe('addResource', () => {
    beforeEach(() => {
      ResourcesManager.initialize(workspacePath);
    });

    it('should add a resource with pending status', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['test', 'demo']
      );

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources).toHaveLength(1);
      expect(data.resources[0]).toMatchObject({
        source: 'https://example.com',
        type: 'web',
        tags: ['test', 'demo'],
        status: 'pending',
      });
      expect(data.resources[0].addedAt).toBeDefined();
    });

    it('should reject duplicate source', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        []
      );

      expect(() =>
        ResourcesManager.addResource(
          workspacePath,
          'https://example.com',
          'web',
          []
        )
      ).toThrow('Resource "https://example.com" already exists');
    });

    it('should add multiple different resources', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['web']
      );
      ResourcesManager.addResource(
        workspacePath,
        'paper.pdf',
        'pdf',
        ['paper']
      );

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources).toHaveLength(2);
      expect(data.resources[0].source).toBe('https://example.com');
      expect(data.resources[1].source).toBe('paper.pdf');
    });
  });

  describe('getCounts', () => {
    beforeEach(() => {
      ResourcesManager.initialize(workspacePath);
    });

    it('should return zero counts for empty resources', () => {
      const counts = ResourcesManager.getCounts(workspacePath);
      expect(counts).toEqual({ total: 0, pending: 0 });
    });

    it('should count total and pending resources', () => {
      // Manually add resources with different statuses
      const data: ResourcesFile = {
        version: 1,
        resources: [
          {
            source: 'https://example.com',
            type: 'web',
            tags: [],
            status: 'pending',
          },
          {
            source: 'https://example2.com',
            type: 'web',
            tags: [],
            status: 'ingested',
            adapter: 'jina',
            output: 'web/example2.md',
          },
          {
            source: 'https://example3.com',
            type: 'web',
            tags: [],
            status: 'pending',
          },
        ],
      };
      ResourcesManager.save(workspacePath, data);

      const counts = ResourcesManager.getCounts(workspacePath);
      expect(counts).toEqual({ total: 3, pending: 2 });
    });
  });

  describe('save', () => {
    it('should save resources.json with proper formatting', () => {
      const data: ResourcesFile = {
        version: 1,
        resources: [
          {
            source: 'https://example.com',
            type: 'web',
            tags: ['test'],
            status: 'pending',
          },
        ],
      };

      ResourcesManager.save(workspacePath, data);

      const resourcesPath = path.join(workspacePath, 'resources.json');
      const content = fs.readFileSync(resourcesPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(data);
      // Check formatting (should have indentation)
      expect(content).toContain('  ');
    });
  });

  describe('removeResource', () => {
    beforeEach(() => {
      ResourcesManager.initialize(workspacePath);
    });

    it('should remove a resource by source', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['test']
      );
      ResourcesManager.addResource(
        workspacePath,
        'https://example2.com',
        'web',
        ['test']
      );

      ResourcesManager.removeResource(workspacePath, 'https://example.com');

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources).toHaveLength(1);
      expect(data.resources[0].source).toBe('https://example2.com');
    });

    it('should throw if source does not exist', () => {
      expect(() =>
        ResourcesManager.removeResource(workspacePath, 'https://nonexistent.com')
      ).toThrow('Resource "https://nonexistent.com" not found');
    });

    it('should return the output path if resource had one', () => {
      // Manually add resource with output
      const data: ResourcesFile = {
        version: 1,
        resources: [
          {
            source: 'https://example.com',
            type: 'web',
            tags: [],
            status: 'ingested',
            output: 'web/example.md',
          },
        ],
      };
      ResourcesManager.save(workspacePath, data);

      const outputPath = ResourcesManager.removeResource(
        workspacePath,
        'https://example.com'
      );

      expect(outputPath).toBe('web/example.md');
    });

    it('should return undefined if resource had no output', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        []
      );

      const outputPath = ResourcesManager.removeResource(
        workspacePath,
        'https://example.com'
      );

      expect(outputPath).toBeUndefined();
    });
  });

  describe('updateTags', () => {
    beforeEach(() => {
      ResourcesManager.initialize(workspacePath);
    });

    it('should add new tags to a resource', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['tag1']
      );

      ResourcesManager.updateTags(
        workspacePath,
        'https://example.com',
        ['tag2', 'tag3'],
        []
      );

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources[0].tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should remove tags from a resource', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['tag1', 'tag2', 'tag3']
      );

      ResourcesManager.updateTags(
        workspacePath,
        'https://example.com',
        [],
        ['tag2']
      );

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources[0].tags).toEqual(['tag1', 'tag3']);
    });

    it('should add and remove tags in the same operation', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['old1', 'old2']
      );

      ResourcesManager.updateTags(
        workspacePath,
        'https://example.com',
        ['new1', 'new2'],
        ['old1']
      );

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources[0].tags).toEqual(['old2', 'new1', 'new2']);
    });

    it('should not add duplicate tags', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['tag1']
      );

      ResourcesManager.updateTags(
        workspacePath,
        'https://example.com',
        ['tag1', 'tag2'],
        []
      );

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources[0].tags).toEqual(['tag1', 'tag2']);
    });

    it('should silently ignore removing non-existent tags', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['tag1']
      );

      ResourcesManager.updateTags(
        workspacePath,
        'https://example.com',
        [],
        ['nonexistent']
      );

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources[0].tags).toEqual(['tag1']);
    });

    it('should throw if source does not exist', () => {
      expect(() =>
        ResourcesManager.updateTags(
          workspacePath,
          'https://nonexistent.com',
          ['tag1'],
          []
        )
      ).toThrow('Resource "https://nonexistent.com" not found');
    });

    it('should handle empty tag operations', () => {
      ResourcesManager.addResource(
        workspacePath,
        'https://example.com',
        'web',
        ['tag1']
      );

      ResourcesManager.updateTags(
        workspacePath,
        'https://example.com',
        [],
        []
      );

      const data = ResourcesManager.load(workspacePath);
      expect(data.resources[0].tags).toEqual(['tag1']);
    });
  });
});
