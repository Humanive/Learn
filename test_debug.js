import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const CLI = path.resolve('./apps/cli/dist/cli.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-test-debug-'));

const run = (args, cwd = home) =>
  spawnSync('node', [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: home, FORCE_COLOR: '0' },
    encoding: 'utf-8',
  });

const workspaceDir = (name) => path.join(home, 'Learn', name);

// Setup
console.log('Creating workspace...');
run(['new', 'test-workspace']);
console.log('Adding resource...');
run(['add', 'https://example.com', '-t', 'initial']);
console.log('Adding more tags...');
const addResult = run(['tag', 'https://example.com', '+tag2', '+tag3']);
console.log('Add tags status:', addResult.status);
console.log('Add tags stdout:', addResult.stdout);
console.log('Add tags stderr:', addResult.stderr);

// Test remove
console.log('\nRemoving tag2...');
const result = run(['tag', 'https://example.com', '-tag2']);
console.log('Status:', result.status);
console.log('Stdout:', result.stdout);
console.log('Stderr:', result.stderr);

// Cleanup
fs.rmSync(home, { recursive: true, force: true });
