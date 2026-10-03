import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES } from './npm-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, '.npm-release');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'learn-npm-smoke-'));
try {
  await mkdir(destination, { recursive: true });
  const tarballs = [];
  let version;
  for (const { directory, name } of PACKAGES) {
    const manifest = JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8'));
    version = manifest.version;
    execFileSync('pnpm', ['--dir', directory, 'pack', '--pack-destination', destination], {
      cwd: root, stdio: 'inherit',
    });
    const tarball = path.join(destination, `${name.replace('@', '').replace('/', '-')}-${version}.tgz`);
    const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n');
    assert(files.some((file) => file.startsWith('package/dist/')));
    assert(files.every((file) => file.startsWith('package/dist/') ||
      ['package/package.json', 'package/README.md', 'package/LICENSE'].includes(file)),
    'Unexpected source or development file in package');
    const packed = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
    assert(!JSON.stringify(packed.dependencies || {}).includes('workspace:'));
    tarballs.push(tarball);
  }
  await writeFile(path.join(temporary, 'package.json'), '{"private":true}\n');
  execFileSync('npm', ['install', '--prefix', temporary, '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], {
    cwd: temporary, stdio: 'inherit',
  });
  const isolatedHome = path.join(temporary, 'home');
  await mkdir(isolatedHome);
  const executable = path.join(temporary, 'node_modules', '.bin', 'learn');
  const run = (args) => execFileSync(executable, args, {
    cwd: temporary, encoding: 'utf8',
    env: { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome, FORCE_COLOR: '0' },
  });
  assert.equal(run(['--version']).trim(), version);
  assert.deepEqual(JSON.parse(run(['list', '--json'])), []);
  run(['new', 'release-check']);
  run(['add', 'https://example.com/article', '--workspace', 'release-check', '--title', 'Release check']);
  assert.deepEqual(JSON.parse(run(['list', '--json'])), ['release-check']);
  assert.match(run(['add', '--help']), /--title/);
  const resources = JSON.parse(await readFile(path.join(isolatedHome, 'Learn', 'release-check', 'resources.json'), 'utf8'));
  assert.equal(resources.resources[0].source, 'https://example.com/article');
  assert.equal(resources.resources[0].title, 'Release check');
  assert.equal(resources.resources[0].status, 'pending');
  console.log(`Verified npm installation and Raycast CLI compatibility for ${version}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
