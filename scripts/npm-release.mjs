import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RELEASE_DIR = path.join(ROOT, '.npm-release');
export const PACKAGES = [
  { directory: 'packages/core', name: '@humanive/learn-core' },
  { directory: 'apps/cli', name: '@humanive/learn-cli' },
];

function parts(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Expected a stable release version, got ${version}`);
  }
  return version.split('.').map(Number);
}

function compare(a, b) {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function planRelease(baseline, commit, registries) {
  parts(baseline);
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('A full Git commit SHA is required');
  }
  const releasedVersions = registries.flatMap((registry) => Object.keys(registry.versions || {}))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version));
  const matchingVersions = [...new Set(registries.flatMap((registry) =>
    Object.entries(registry.versions || {})
      .filter(([, manifest]) => manifest.learnRelease?.commit === commit)
      .map(([version]) => version),
  ))];
  if (matchingVersions.length > 1) {
    throw new Error('This commit has conflicting published versions');
  }
  let version = matchingVersions[0] || baseline;
  if (!matchingVersions.length && releasedVersions.some((existing) => compare(existing, baseline) >= 0)) {
    const latest = releasedVersions.sort(compare).at(-1);
    const [major, minor, patch] = parts(latest);
    version = `${major}.${minor}.${patch + 1}`;
  }
  const skip = registries.map((registry) => {
    const existing = registry.versions?.[version];
    if (!existing) return false;
    if (existing.learnRelease?.commit !== commit) {
      throw new Error(`Version ${version} already belongs to another commit`);
    }
    return true;
  });
  if (skip.some((published) => !published) && releasedVersions.some((existing) => compare(existing, version) > 0)) {
    throw new Error('A newer release is already published; run the workflow for the latest main commit');
  }
  return { commit, version, skip };
}

async function registryMetadata(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return { versions: {} };
  if (!response.ok) throw new Error(`npm lookup for ${name} failed: HTTP ${response.status}`);
  return response.json();
}

async function readManifest(directory) {
  return JSON.parse(await readFile(path.join(ROOT, directory, 'package.json'), 'utf8'));
}

function verifyReleaseOrder(commit, registries) {
  for (const registry of registries) {
    const latest = Object.keys(registry.versions || {}).filter((version) => /^\d+\.\d+\.\d+$/.test(version)).sort(compare).at(-1);
    const previous = registry.versions?.[latest]?.learnRelease?.commit;
    if (!previous || previous === commit) continue;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', previous, commit], { cwd: ROOT, stdio: 'pipe' });
    } catch {
      throw new Error('A newer or unrelated commit has been published; run this workflow from current main');
    }
  }
}

async function prepare() {
  const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const manifests = await Promise.all(PACKAGES.map(({ directory }) => readManifest(directory)));
  if (manifests[0].version !== manifests[1].version) {
    throw new Error('Core and CLI must use the same baseline version');
  }
  const registries = await Promise.all(PACKAGES.map(({ name }) => registryMetadata(name)));
  const plan = planRelease(manifests[0].version, commit, registries);
  if (plan.skip.some((published) => !published)) verifyReleaseOrder(commit, registries);
  for (const [index, { directory, name }] of PACKAGES.entries()) {
    if (manifests[index].name !== name) throw new Error(`Unexpected package name in ${directory}`);
    const manifest = { ...manifests[index], version: plan.version, learnRelease: { commit } };
    await writeFile(path.join(ROOT, directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  await mkdir(RELEASE_DIR, { recursive: true });
  await writeFile(path.join(RELEASE_DIR, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`Prepared ${plan.version} for ${commit}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY,
      `npm release: **${plan.version}**, commit \`${commit}\`\n\n` +
      PACKAGES.map(({ name }, i) => `- ${name}: ${plan.skip[i] ? 'already published' : 'ready to publish'}\n`).join(''),
      { flag: 'a' });
  }
}

async function publish() {
  const plan = JSON.parse(await readFile(path.join(RELEASE_DIR, 'plan.json'), 'utf8'));
  const registries = await Promise.all(PACKAGES.map(({ name }) => registryMetadata(name)));
  const currentPlan = planRelease(plan.version, plan.commit, registries);
  if (currentPlan.skip.some((published) => !published)) verifyReleaseOrder(plan.commit, registries);
  for (const [index, { directory, name }] of PACKAGES.entries()) {
    const existing = (await registryMetadata(name)).versions?.[plan.version];
    if (existing) {
      if (existing.learnRelease?.commit !== plan.commit) {
        throw new Error(`${name}@${plan.version} belongs to another commit`);
      }
      console.log(`Skipping ${name}@${plan.version}: already published`);
      continue;
    }
    const manifest = await readManifest(directory);
    if (manifest.version !== plan.version || manifest.learnRelease?.commit !== plan.commit) {
      throw new Error(`Release manifest changed for ${name}`);
    }
    const tarball = path.join(RELEASE_DIR, `${name.replace('@', '').replace('/', '-')}-${plan.version}.tgz`);
    // npm CLI handles OIDC; pnpm pack has already replaced workspace dependencies.
    execFileSync('npm', ['publish', tarball, '--registry', 'https://registry.npmjs.org', '--access', 'public', '--tag', 'latest'], {
      cwd: path.join(ROOT, directory), stdio: 'inherit',
    });
    if (index === 0) {
      // npm can take a few seconds to expose a newly published dependency.
      let visible = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        if ((await registryMetadata(name)).versions?.[plan.version]) {
          visible = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      if (!visible) throw new Error('Core publication is not visible yet; rerun this workflow');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commands = { prepare, publish };
  const command = commands[process.argv[2]];
  if (!command) throw new Error('Usage: node scripts/npm-release.mjs <prepare|publish>');
  await command();
}
