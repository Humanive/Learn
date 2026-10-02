import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('CLI End-to-End: new → add → list', () => {
  let testHome: string;
  let originalHome: string | undefined;
  let cliPath: string;

  beforeEach(() => {
    // Create isolated temp HOME
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-cli-e2e-'));
    originalHome = process.env.HOME;
    process.env.HOME = testHome;

    // CLI executable path
    cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
  });

  afterEach(() => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    // Clean up test directory
    fs.rmSync(testHome, { recursive: true, force: true });
  });

  it('should create workspace, add resources, and list them', () => {
    const workspaceName = 'test-workspace';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Step 1: learn new <name>
    const newOutput = execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    expect(newOutput).toContain('Workspace created successfully');
    expect(fs.existsSync(workspacePath)).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'resources.json'))).toBe(true);

    // Verify the five output folders exist
    for (const dir of ['web', 'pdf', 'video', 'repos', 'local']) {
      expect(fs.existsSync(path.join(workspacePath, dir))).toBe(true);
    }

    // Verify old structure does NOT exist
    expect(fs.existsSync(path.join(workspacePath, '.learn'))).toBe(false);
    expect(fs.existsSync(path.join(workspacePath, 'SOURCES.md'))).toBe(false);
    expect(fs.existsSync(path.join(workspacePath, 'INDEX.md'))).toBe(false);

    // Verify resources.json content
    const resourcesContent = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    expect(resourcesContent.version).toBe(1);
    expect(resourcesContent.resources).toEqual([]);

    // Step 2: learn add <source> -t a,b
    const addOutput1 = execSync(
      `node ${cliPath} add https://example.com -t web,tutorial -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    expect(addOutput1).toContain('Resource added to workspace');
    expect(addOutput1).toContain('Detected type: web');

    // Verify resource was added
    const resourcesAfterAdd1 = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    expect(resourcesAfterAdd1.resources).toHaveLength(1);
    expect(resourcesAfterAdd1.resources[0]).toMatchObject({
      source: 'https://example.com',
      type: 'web',
      tags: ['web', 'tutorial'],
      status: 'pending',
    });

    // Step 3: Add another resource
    const addOutput2 = execSync(
      `node ${cliPath} add https://github.com/user/repo -t code -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    expect(addOutput2).toContain('Resource added to workspace');
    expect(addOutput2).toContain('Detected type: repos');

    // Step 4: Verify adding duplicate source is rejected
    try {
      execSync(
        `node ${cliPath} add https://example.com -t duplicate -w ${workspaceName}`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toContain('already exists');
    }

    // Step 5: learn list
    const listOutput = execSync(`node ${cliPath} list`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    expect(listOutput).toContain(workspaceName);
    expect(listOutput).toContain('Resources: 2');
    expect(listOutput).toContain('2 pending');
  });

  it('should handle invalid resources.json gracefully', () => {
    const workspaceName = 'test-workspace';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Corrupt resources.json with invalid JSON
    fs.writeFileSync(
      path.join(workspacePath, 'resources.json'),
      '{ invalid json }'
    );

    // Try to add a resource - should fail with clear error
    try {
      execSync(
        `node ${cliPath} add https://example.com -w ${workspaceName}`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain('invalid JSON');
    }

    // Verify file was NOT overwritten
    const content = fs.readFileSync(
      path.join(workspacePath, 'resources.json'),
      'utf-8'
    );
    expect(content).toBe('{ invalid json }');
  });

  it('should handle invalid resources.json structure', () => {
    const workspaceName = 'test-workspace';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Write invalid structure (missing version)
    fs.writeFileSync(
      path.join(workspacePath, 'resources.json'),
      JSON.stringify({ resources: [] })
    );

    // Try to add a resource - should fail with clear error
    try {
      execSync(
        `node ${cliPath} add https://example.com -w ${workspaceName}`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain('invalid structure');
    }
  });
});
