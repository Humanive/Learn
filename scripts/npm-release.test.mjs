import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRelease } from './npm-release.mjs';

const commit = 'a'.repeat(40);
const earlier = 'b'.repeat(40);
const released = (sha) => ({ learnRelease: { commit: sha } });

test('uses the baseline for the first publication', () => {
  assert.deepEqual(planRelease('0.1.0', commit, [{}, {}]), {
    commit, version: '0.1.0', skip: [false, false],
  });
});

test('increments the highest stable npm version', () => {
  const plan = planRelease('0.1.0', commit, [
    { versions: { '0.1.9': released(earlier), '1.0.0-beta.1': released(earlier) } },
    { versions: { '0.1.10': released(earlier) } },
  ]);
  assert.equal(plan.version, '0.1.11');
});

test('reuses a newer baseline supplied in the repository', () => {
  assert.equal(planRelease('0.2.0', commit, [
    { versions: { '0.1.10': released(earlier) } }, {},
  ]).version, '0.2.0');
});

test('resumes after core was published but CLI failed', () => {
  assert.deepEqual(planRelease('0.1.0', commit, [
    { versions: { '0.1.2': released(commit) } },
    { versions: { '0.1.1': released(earlier) } },
  ]), { commit, version: '0.1.2', skip: [true, false] });
});

test('a completed rerun skips both packages', () => {
  const registry = { versions: { '0.1.2': released(commit) } };
  assert.deepEqual(planRelease('0.1.0', commit, [registry, registry]).skip, [true, true]);
});

test('an older completed rerun skips both packages after a newer release', () => {
  const registry = { versions: { '0.1.2': released(commit), '0.1.3': released(earlier) } };
  assert.deepEqual(planRelease('0.1.0', commit, [registry, registry]).skip, [true, true]);
});

test('rejects resuming an older partial release after a newer publication', () => {
  assert.throws(() => planRelease('0.1.0', commit, [
    { versions: { '0.1.2': released(commit), '0.1.3': released(earlier) } },
    { versions: { '0.1.3': released(earlier) } },
  ]), /newer release/);
});

test('rejects another package owning the planned version', () => {
  assert.throws(() => planRelease('0.1.0', commit, [
    { versions: { '0.1.2': released(commit) } },
    { versions: { '0.1.2': released(earlier) } },
  ]), /another commit/);
});
