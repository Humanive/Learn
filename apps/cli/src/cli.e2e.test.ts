import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('CLI End-to-End: Integration Tests', () => {
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

  // ============================================================================
  // TEST GROUP 1: Full workflow with multiple resource types
  // ============================================================================

  it('should handle full workflow: new → add multiple resources (mixed types) → list → verify outputs exist', () => {
    const workspaceName = 'test-full-workflow';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Step 1: Create workspace
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

    // Step 2: Add mixed resource types
    const resources = [
      { url: 'https://example.com/article', type: 'web', tags: ['web', 'tutorial'] },
      { url: 'https://arxiv.org/pdf/2301.00001.pdf', type: 'pdf', tags: ['research', 'ai'] },
      { url: 'https://github.com/user/repo', type: 'repos', tags: ['code', 'opensource'] },
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', type: 'video', tags: ['video', 'tutorial'] },
    ];

    for (const resource of resources) {
      const addOutput = execSync(
        `node ${cliPath} add ${resource.url} -t ${resource.tags.join(',')} -w ${workspaceName}`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );

      expect(addOutput).toContain('Resource added');
      expect(addOutput).toContain(`Detected type: ${resource.type}`);
    }

    // Step 3: Verify resources.json state
    let resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );

    expect(resourcesData.resources).toHaveLength(4);

    // Verify each resource has correct structure
    resourcesData.resources.forEach((r: any, idx: number) => {
      expect(r.source).toBe(resources[idx].url);
      expect(r.type).toBe(resources[idx].type);
      expect(r.tags).toEqual(resources[idx].tags);
      expect(r.status).toBe('pending');
      expect(r.addedAt).toBeDefined();
      expect(typeof r.addedAt).toBe('string');
    });

    // Step 4: Verify list command output
    const listOutput = execSync(`node ${cliPath} list`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    expect(listOutput).toContain(workspaceName);
    expect(listOutput).toContain('Resources: 4');
    expect(listOutput).toContain('4 pending');

    // Step 5: Simulate ingestion by manually updating resources
    resourcesData.resources.forEach((r: any, idx: number) => {
      r.status = 'ingested';
      r.adapter = 'mock-adapter';
      r.ingestedAt = new Date().toISOString();

      // Set output paths based on type
      if (r.type === 'web') {
        r.output = `web/article-${idx}.md`;
      } else if (r.type === 'pdf') {
        r.output = `pdf/paper-${idx}.md`;
      } else if (r.type === 'repos') {
        r.output = `repos/repo-${idx}`;
      } else if (r.type === 'video') {
        r.output = `video/video-${idx}.md`;
      }
    });

    fs.writeFileSync(
      path.join(workspacePath, 'resources.json'),
      JSON.stringify(resourcesData, null, 2)
    );

    // Step 6: Create output files/folders to verify they exist in correct locations
    resourcesData.resources.forEach((r: any) => {
      const outputPath = path.join(workspacePath, r.output);
      if (r.type === 'repos') {
        // Repos are folders
        fs.mkdirSync(outputPath, { recursive: true });
        fs.writeFileSync(path.join(outputPath, 'README.md'), '# Repo content');
      } else {
        fs.writeFileSync(outputPath, `# ${r.type} content`);
      }
      expect(fs.existsSync(outputPath)).toBe(true);
    });

    // Step 7: Verify final list shows ingested resources
    const finalListOutput = execSync(`node ${cliPath} list`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    expect(finalListOutput).toContain(workspaceName);
    expect(finalListOutput).toContain('Resources: 4');
    expect(finalListOutput).toContain('0 pending');
  });

  // ============================================================================
  // TEST GROUP 2: Error handling
  // ============================================================================

  it('should handle invalid URLs gracefully', () => {
    const workspaceName = 'test-invalid-url';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Try to add invalid URLs
    const invalidSources = [
      'not-a-url',
      'ftp://invalid.protocol.com',
    ];

    for (const source of invalidSources) {
      try {
        execSync(
          `node ${cliPath} add "${source}" -w ${workspaceName}`,
          {
            encoding: 'utf-8',
            env: { ...process.env, HOME: testHome },
          }
        );
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        // Should fail with clear error message
        expect(error.status).toBe(1);
      }
    }

    // Verify no resources were added
    const resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    expect(resourcesData.resources).toHaveLength(0);
  });

  it('should handle missing workspace gracefully', () => {
    // Try to add to non-existent workspace
    try {
      execSync(
        `node ${cliPath} add https://example.com -w non-existent-workspace`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toContain('does not exist');
    }

    // Try to list when no workspaces exist
    const learnDir = path.join(testHome, 'Learn');
    if (!fs.existsSync(learnDir)) {
      fs.mkdirSync(learnDir, { recursive: true });
    }

    const listOutput = execSync(`node ${cliPath} list`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    expect(listOutput).toContain('No workspaces found');
  });

  it('should handle invalid resources.json gracefully', () => {
    const workspaceName = 'test-invalid-json';
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
    const workspaceName = 'test-invalid-structure';
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

  // ============================================================================
  // TEST GROUP 3: Duplicate handling
  // ============================================================================

  it('should reject duplicate resources', () => {
    const workspaceName = 'test-duplicates';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Add first resource
    execSync(
      `node ${cliPath} add https://example.com/page -t web -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    // Try to add the same resource again
    try {
      execSync(
        `node ${cliPath} add https://example.com/page -t duplicate -w ${workspaceName}`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain('already exists');
    }

    // Verify only one resource exists
    const resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    expect(resourcesData.resources).toHaveLength(1);
    expect(resourcesData.resources[0].tags).toEqual(['web']); // Original tags preserved
  });

  // ============================================================================
  // TEST GROUP 4: Tag workflow
  // ============================================================================

  it('should support full tag workflow: add → tag → list filtered by tags', () => {
    const workspaceName = 'test-tags';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Add multiple resources with different tags
    const resources = [
      { url: 'https://example.com/tutorial1', tags: ['tutorial', 'beginner'] },
      { url: 'https://example.com/tutorial2', tags: ['tutorial', 'advanced'] },
      { url: 'https://example.com/reference', tags: ['reference', 'api'] },
    ];

    for (const resource of resources) {
      execSync(
        `node ${cliPath} add ${resource.url} -t ${resource.tags.join(',')} -w ${workspaceName}`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );
    }

    // Modify tags on first resource
    const tagOutput1 = execSync(
      `node ${cliPath} tag https://example.com/tutorial1 -w ${workspaceName} +javascript -beginner`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    expect(tagOutput1).toContain('Tags updated');
    expect(tagOutput1).toContain('Added: javascript');
    expect(tagOutput1).toContain('Removed: beginner');

    // Verify tag changes
    let resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );

    const resource1 = resourcesData.resources.find(
      (r: any) => r.source === 'https://example.com/tutorial1'
    );
    expect(resource1.tags).toEqual(['tutorial', 'javascript']);
    expect(resource1.tags).not.toContain('beginner');

    // Add tag to second resource
    const tagOutput2 = execSync(
      `node ${cliPath} tag https://example.com/tutorial2 -w ${workspaceName} +javascript`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    expect(tagOutput2).toContain('Tags updated');
    expect(tagOutput2).toContain('Added: javascript');

    resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );

    const resource2 = resourcesData.resources.find(
      (r: any) => r.source === 'https://example.com/tutorial2'
    );
    expect(resource2.tags).toContain('javascript');
    expect(resource2.tags).toContain('tutorial');
    expect(resource2.tags).toContain('advanced');
  });

  it('should handle tag operations on non-existent resources', () => {
    const workspaceName = 'test-tag-errors';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Try to tag non-existent resource
    try {
      execSync(
        `node ${cliPath} tag https://example.com/nonexistent -w ${workspaceName} +tag1`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain('not found');
    }
  });

  // ============================================================================
  // TEST GROUP 5: Remove workflow
  // ============================================================================

  it('should remove resource without --purge (keeps output)', () => {
    const workspaceName = 'test-rm-keep';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Add a resource
    execSync(
      `node ${cliPath} add https://example.com/article -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    // Manually simulate an ingested resource with output
    let resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    resourcesData.resources[0].output = 'web/article.md';
    resourcesData.resources[0].status = 'ingested';
    fs.writeFileSync(
      path.join(workspacePath, 'resources.json'),
      JSON.stringify(resourcesData, null, 2)
    );

    // Create the output file
    const outputPath = path.join(workspacePath, 'web', 'article.md');
    fs.writeFileSync(outputPath, '# Article Content');
    expect(fs.existsSync(outputPath)).toBe(true);

    // Remove resource without --purge
    const rmOutput = execSync(
      `node ${cliPath} rm https://example.com/article -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    expect(rmOutput).toContain('Resource removed');
    expect(rmOutput).toContain('Output kept');

    // Verify resource was removed but output file still exists
    resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    expect(resourcesData.resources).toHaveLength(0);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('should remove resource with --purge (deletes output)', () => {
    const workspaceName = 'test-rm-purge';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Add a resource
    execSync(
      `node ${cliPath} add https://example.com/article -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    // Manually simulate an ingested resource with output
    let resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    resourcesData.resources[0].output = 'web/article.md';
    resourcesData.resources[0].status = 'ingested';
    fs.writeFileSync(
      path.join(workspacePath, 'resources.json'),
      JSON.stringify(resourcesData, null, 2)
    );

    const outputPath = path.join(workspacePath, 'web', 'article.md');
    fs.writeFileSync(outputPath, '# Article Content');

    // Remove with --purge
    const rmPurgeOutput = execSync(
      `node ${cliPath} rm https://example.com/article -w ${workspaceName} --purge`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    expect(rmPurgeOutput).toContain('Resource removed');
    expect(rmPurgeOutput).toContain('Deleted file');

    // Verify both resource and output were removed
    resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    expect(resourcesData.resources).toHaveLength(0);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('should handle --purge for repo folders', () => {
    const workspaceName = 'test-rm-repo';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Add a repo
    execSync(
      `node ${cliPath} add https://github.com/user/repo -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    // Manually simulate ingested repo with folder output
    let resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    resourcesData.resources[0].output = 'repos/repo';
    resourcesData.resources[0].status = 'ingested';
    fs.writeFileSync(
      path.join(workspacePath, 'resources.json'),
      JSON.stringify(resourcesData, null, 2)
    );

    // Create repo folder with files
    const repoPath = path.join(workspacePath, 'repos', 'repo');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Repo');
    fs.writeFileSync(path.join(repoPath, 'file.txt'), 'Content');

    expect(fs.existsSync(repoPath)).toBe(true);

    // Remove with --purge (should delete entire folder)
    const rmOutput = execSync(
      `node ${cliPath} rm https://github.com/user/repo -w ${workspaceName} --purge`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    expect(rmOutput).toContain('Resource removed');
    expect(rmOutput).toContain('Deleted directory');
    expect(fs.existsSync(repoPath)).toBe(false);
  });

  // ============================================================================
  // TEST GROUP 6: Resource state transitions and output verification
  // ============================================================================

  it('should track resource state transitions correctly', () => {
    const workspaceName = 'test-state-transitions';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Add resource (starts as pending)
    execSync(
      `node ${cliPath} add https://example.com/doc -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );

    let resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    expect(resourcesData.resources[0].status).toBe('pending');
    expect(resourcesData.resources[0].addedAt).toBeDefined();
    expect(resourcesData.resources[0].output).toBeUndefined();

    // Simulate ingestion: change status to ingested, add output
    resourcesData.resources[0].status = 'ingested';
    resourcesData.resources[0].output = 'web/doc.md';
    resourcesData.resources[0].adapter = 'jina';
    resourcesData.resources[0].ingestedAt = new Date().toISOString();

    fs.writeFileSync(
      path.join(workspacePath, 'resources.json'),
      JSON.stringify(resourcesData, null, 2)
    );

    // Create output file
    const outputPath = path.join(workspacePath, 'web', 'doc.md');
    fs.writeFileSync(outputPath, '# Document Content\n\nIngested content here.');

    // Verify file exists
    expect(fs.existsSync(outputPath)).toBe(true);

    // Reload and verify state
    resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );

    expect(resourcesData.resources[0].status).toBe('ingested');
    expect(resourcesData.resources[0].output).toBe('web/doc.md');
    expect(resourcesData.resources[0].adapter).toBe('jina');
    expect(resourcesData.resources[0].ingestedAt).toBeDefined();
  });

  it('should verify output files exist in correct locations for different resource types', () => {
    const workspaceName = 'test-output-locations';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Add resources of different types
    const resources = [
      { url: 'https://example.com/page', type: 'web', folder: 'web', filename: 'page.md' },
      { url: 'https://arxiv.org/pdf/2301.00001.pdf', type: 'pdf', folder: 'pdf', filename: 'paper.md' },
      { url: 'https://github.com/user/repo', type: 'repos', folder: 'repos', filename: 'repo' },
      { url: 'https://www.youtube.com/watch?v=abc123', type: 'video', folder: 'video', filename: 'video.md' },
    ];

    for (const resource of resources) {
      execSync(
        `node ${cliPath} add ${resource.url} -w ${workspaceName}`,
        {
          encoding: 'utf-8',
          env: { ...process.env, HOME: testHome },
        }
      );
    }

    // Simulate ingestion for each resource type
    const resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );

    resources.forEach((resource, idx) => {
      const outputPath = path.join(resource.folder, resource.filename);
      resourcesData.resources[idx].status = 'ingested';
      resourcesData.resources[idx].output = outputPath;

      // Create the output file/folder
      const fullPath = path.join(workspacePath, outputPath);
      if (resource.type === 'repos') {
        // Repos are folders
        fs.mkdirSync(fullPath, { recursive: true });
        fs.writeFileSync(path.join(fullPath, 'README.md'), '# Repo content');
      } else {
        fs.writeFileSync(fullPath, `# ${resource.type} content`);
      }

      expect(fs.existsSync(fullPath)).toBe(true);
    });

    fs.writeFileSync(
      path.join(workspacePath, 'resources.json'),
      JSON.stringify(resourcesData, null, 2)
    );

    // Verify all outputs are in the correct folders
    const finalData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );

    finalData.resources.forEach((resource: any, idx: number) => {
      expect(resource.output).toBe(path.join(resources[idx].folder, resources[idx].filename));
      expect(fs.existsSync(path.join(workspacePath, resource.output))).toBe(true);
    });
  });

  // ============================================================================
  // TEST GROUP 7: Local path handling
  // ============================================================================

  it('should handle local file and folder paths correctly', () => {
    const workspaceName = 'test-local-paths';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Create a test local file (PDF)
    const testPdfPath = path.join(testHome, 'test-document.pdf');
    fs.writeFileSync(testPdfPath, 'PDF content here');

    // Create a test local folder
    const testFolderPath = path.join(testHome, 'test-folder');
    fs.mkdirSync(testFolderPath, { recursive: true });
    fs.writeFileSync(path.join(testFolderPath, 'file.txt'), 'Content');

    // Add local PDF file
    const addPdfOutput = execSync(
      `node ${cliPath} add ${testPdfPath} -t local-pdf -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );
    expect(addPdfOutput).toContain('Resource added');
    expect(addPdfOutput).toContain('Detected type: pdf');

    // Add local folder
    const addFolderOutput = execSync(
      `node ${cliPath} add ${testFolderPath} -t local-folder -w ${workspaceName}`,
      {
        encoding: 'utf-8',
        env: { ...process.env, HOME: testHome },
      }
    );
    expect(addFolderOutput).toContain('Resource added');
    expect(addFolderOutput).toContain('Detected type: local');

    // Verify resources were added correctly
    const resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );

    expect(resourcesData.resources).toHaveLength(2);
    expect(resourcesData.resources[0].source).toBe(testPdfPath);
    expect(resourcesData.resources[0].type).toBe('pdf');
    expect(resourcesData.resources[1].source).toBe(testFolderPath);
    expect(resourcesData.resources[1].type).toBe('local');
  });

  // ============================================================================
  // TEST GROUP 8: Ingest workflow (if ingest command exists)
  // ============================================================================

  it('should ingest local resources successfully', () => {
    const workspaceName = 'test-ingest';
    const learnDir = path.join(testHome, 'Learn');
    const workspacePath = path.join(learnDir, workspaceName);

    // Step 1: Create workspace
    execSync(`node ${cliPath} new ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Step 2: Create test files to add
    const testFile1 = path.join(testHome, 'test1.txt');
    const testFile2 = path.join(testHome, 'test2.txt');
    fs.writeFileSync(testFile1, 'content 1');
    fs.writeFileSync(testFile2, 'content 2');

    // Step 3: Add resources
    execSync(`node ${cliPath} add ${testFile1} -w ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    execSync(`node ${cliPath} add ${testFile2} -w ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    // Verify both are pending
    let resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );
    expect(resourcesData.resources).toHaveLength(2);
    expect(resourcesData.resources[0].status).toBe('pending');
    expect(resourcesData.resources[1].status).toBe('pending');

    // Step 4: Run ingest
    const ingestOutput = execSync(`node ${cliPath} ingest -w ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    expect(ingestOutput).toContain('Ingesting 2 pending resource(s)');
    expect(ingestOutput).toContain('Ingest Summary');
    expect(ingestOutput).toContain('Succeeded: 2');
    expect(ingestOutput).toContain('Failed: 0');

    // Step 5: Verify resources were ingested
    resourcesData = JSON.parse(
      fs.readFileSync(path.join(workspacePath, 'resources.json'), 'utf-8')
    );

    expect(resourcesData.resources[0].status).toBe('ingested');
    expect(resourcesData.resources[0].adapter).toBe('local');
    expect(resourcesData.resources[0].output).toBeDefined();
    expect(resourcesData.resources[0].ingestedAt).toBeDefined();

    expect(resourcesData.resources[1].status).toBe('ingested');
    expect(resourcesData.resources[1].adapter).toBe('local');
    expect(resourcesData.resources[1].output).toBeDefined();
    expect(resourcesData.resources[1].ingestedAt).toBeDefined();

    // Step 6: Verify symlinks were created
    const output1 = path.join(workspacePath, resourcesData.resources[0].output!);
    const output2 = path.join(workspacePath, resourcesData.resources[1].output!);

    expect(fs.existsSync(output1)).toBe(true);
    expect(fs.existsSync(output2)).toBe(true);
    expect(fs.lstatSync(output1).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(output2).isSymbolicLink()).toBe(true);

    // Step 7: Run ingest again - should skip already ingested resources
    const ingestOutput2 = execSync(`node ${cliPath} ingest -w ${workspaceName}`, {
      encoding: 'utf-8',
      env: { ...process.env, HOME: testHome },
    });

    expect(ingestOutput2).toContain('No pending resources to ingest');
  });
});

