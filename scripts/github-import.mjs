import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ISSUE_METADATA_KEY = 'github_issue_key';
export const ISSUE_ID_METADATA_KEY = 'github_issue_id';
export const ISSUE_MARKER_PREFIX = 'github-source:';
export const COMMENT_MARKER_PREFIX = 'github-comment:';

// Multica parses mention links even inside quoted source content.
const MENTION_SCHEME = /mention:\/\//gi;
const AT_SIGN = /@/g;
// External source text must not forge importer-owned marker lines.
const MARKER_PREFIX = /\b(git(hub)?-(source|comment)):/g;

const GITHUB_PAGE_SIZE = 100;
const GITHUB_MAX_PAGES = 100;
const RECOVERY_SEARCH_CAP = 50;
// The server caps a root comment read at 2000 rows and the pinned CLI does not
// surface the truncation header, so a full page is treated as a read that may
// have dropped the oldest markers.
const COMMENT_ROOT_CAP = 2000;

export function issueKey(repository, number) {
  return `${repository}#${number}`;
}

export function issueMarker(key) {
  return `${ISSUE_MARKER_PREFIX}${key}`;
}

export function commentMarker(key, commentId) {
  return `${COMMENT_MARKER_PREFIX}${key}/${commentId}`;
}

export function sanitizeExternalText(text) {
  return String(text ?? '')
    .replace(/\0/g, '')
    .replace(MENTION_SCHEME, 'mention+')
    .replace(MARKER_PREFIX, '[$1]:')
    .replace(AT_SIGN, '＠');
}

// A longer text fence prevents source HTML and Mermaid blocks from rendering.
function quoteSource(text) {
  const longest = Array.from(text.matchAll(/`+/g), (match) => match[0].length)
    .reduce((longestSoFar, length) => Math.max(longestSoFar, length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function provenance(key, { id, url, author }) {
  return [
    `GitHub issue: ${key} (id ${id})`,
    `Source: ${sanitizeExternalText(url)}`,
    `Author: ${sanitizeExternalText(author)}`,
  ].join('\n');
}

export function buildIssueDescription({ key, id, url, author, body }) {
  const text = sanitizeExternalText(body).trim() || '_No description provided._';
  return `${quoteSource(text)}\n\n---\n\n${issueMarker(key)}\n${provenance(key, { id, url, author })}\n`;
}

// /note prevents implicit assignee routing as well as explicit agent triggers.
export function buildCommentContent({ key, commentId, id, url, author, body }) {
  const text = sanitizeExternalText(body).trim() || '_No comment body._';
  const source = [commentMarker(key, commentId), provenance(key, { id, url, author })].join('\n');
  return `/note Imported from GitHub.\n\n${quoteSource(text)}\n\n---\n\n${source}\n`;
}

function validateIssue(issue) {
  if (!issue || !Number.isSafeInteger(issue.id) || !Number.isSafeInteger(issue.number) || issue.number < 1 ||
      typeof issue.title !== 'string' || typeof issue.html_url !== 'string' ||
      typeof issue.user?.login !== 'string' || (issue.body !== null && typeof issue.body !== 'string')) {
    throw new Error('invalid GitHub issue payload');
  }
}

function validateComment(comment) {
  if (!comment || !Number.isSafeInteger(comment.id) || comment.id < 1 ||
      typeof comment.html_url !== 'string' || typeof comment.user?.login !== 'string' ||
      (comment.body !== null && typeof comment.body !== 'string') ||
      !Number.isFinite(Date.parse(comment.created_at))) {
    throw new Error('invalid GitHub comment payload');
  }
}

export function readEvent(payload, eventName) {
  if (eventName === 'issues') {
    if (payload.action !== 'opened') return { kind: 'skip', reason: `issues.${payload.action} is not imported` };
    return { kind: 'issue', issue: payload.issue };
  }
  if (eventName === 'issue_comment') {
    if (payload.action !== 'created') {
      return { kind: 'skip', reason: `issue_comment.${payload.action} is not imported` };
    }
    // A pull request reaches this event too, and its comments belong to the
    // review conversation rather than to the imported issue.
    if (payload.issue?.pull_request) return { kind: 'skip', reason: 'comment on a pull request' };
    return { kind: 'comment', issue: payload.issue, comment: payload.comment };
  }
  return { kind: 'skip', reason: `unsupported event ${eventName}` };
}

export function buildCommentsUrl({ serverUrl, repository, number, page }) {
  const base = (serverUrl || 'https://api.github.com').replace(/\/+$/, '');
  return `${base}/repos/${repository.split('/').map(encodeURIComponent).join('/')}/issues/${number}/comments?per_page=${GITHUB_PAGE_SIZE}&page=${page}`;
}

export async function fetchIssueComments(httpFetch, { serverUrl, token, repository, number, since }) {
  const comments = [];
  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    const response = await httpFetch(buildCommentsUrl({ serverUrl, repository, number, page }), {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'humanive-learn-github-import',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub comment list failed: HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('invalid GitHub comment list');
    batch.forEach(validateComment);
    comments.push(...batch);
    if (batch.length < GITHUB_PAGE_SIZE) {
      return since === undefined ? comments : comments.filter((comment) => createdAt(comment) >= since);
    }
  }
  throw new Error('GitHub comment pagination exceeded 100 pages; no comments were imported');
}

function createdAt(comment) {
  const parsed = Date.parse(comment.created_at ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function createCommandRunner({ cwd = process.cwd(), env = process.env } = {}) {
  return async (args) => {
    try {
      const { stdout, stderr } = await execFileAsync(args[0], args.slice(1), {
        cwd,
        env,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
      });
      return { stdout, stderr };
    } catch (error) {
      throw new Error(`CLI command failed with code ${error.code ?? 'unknown'}; rerun after resolving the CLI failure`);
    }
  };
}

async function writeBodyFile(workDir, name, content) {
  const file = path.join(workDir, name);
  await writeFile(file, content, 'utf8');
  return file;
}

async function multicaJson(run, args) {
  const { stdout } = await run(['multica', ...args, '--output', 'json']);
  return stdout.trim() ? JSON.parse(stdout) : null;
}

async function findByMetadata(run, key) {
  const page = await multicaJson(run, [
    'issue', 'list',
    '--metadata', `${ISSUE_METADATA_KEY}=${key}`,
    '--limit', '2',
    '--fields', 'id,identifier,title,metadata',
  ]);
  const issues = page?.issues;
  if (!Array.isArray(issues)) throw new Error('invalid Multica issue list response');
  if (issues.length > 1 || page.has_more === true) {
    throw new Error(`${key} is mapped to ${issues.length} Multica issues; resolve the duplicate before importing again`);
  }
  return issues[0] ?? null;
}

// Metadata is written after the issue exists, so a failure in between leaves an
// issue the next run has to recognise. The body marker is the fallback.
async function findByDescriptionMarker(run, key) {
  const marker = issueMarker(key);
  const result = await multicaJson(run, [
    'issue', 'search', marker, '--include-closed', '--limit', String(RECOVERY_SEARCH_CAP),
  ]);
  if (!Array.isArray(result?.issues)) throw new Error('invalid Multica search response');
  if (result.issues.length >= RECOVERY_SEARCH_CAP) throw new Error('Multica recovery search reached its result cap');
  const matches = [];
  for (const candidate of result.issues) {
    const issue = await multicaJson(run, ['issue', 'get', candidate.id]);
    if (String(issue.description ?? '').split('\n').some((line) => line === marker)) matches.push(issue);
  }
  if (matches.length > 1) {
    throw new Error(`${matches.length} Multica issues carry ${marker}; resolve the duplicate before importing again`);
  }
  return matches[0] ?? null;
}

async function setMetadata(run, issueId, key, sourceId) {
  await run([
    'multica', 'issue', 'metadata', 'set', issueId,
    '--key', ISSUE_METADATA_KEY,
    '--value', key,
    '--output', 'json',
  ]);
  await run([
    'multica', 'issue', 'metadata', 'set', issueId,
    '--key', ISSUE_ID_METADATA_KEY,
    '--value', String(sourceId),
    '--type', 'string',
    '--output', 'json',
  ]);
}

async function createIssue(run, { workDir, project }, source, key) {
  const descriptionFile = await writeBodyFile(workDir, 'issue.md', buildIssueDescription({
    key,
    id: source.id,
    url: source.html_url,
    author: source.user?.login,
    body: source.body,
  }));
  const args = [
    'issue', 'create',
    '--title', sanitizeExternalText(source.title) || issueMarker(key),
    '--description-file', descriptionFile,
    '--status', 'todo',
    '--allow-duplicate',
  ];
  if (project) args.push('--project', project);
  return multicaJson(run, args);
}

async function resolveIssue(run, workDir, project, repository, source) {
  const key = issueKey(repository, source.number);
  const known = await findByMetadata(run, key);
  if (known) {
    if (known.metadata?.github_issue_id !== undefined && String(known.metadata.github_issue_id) !== String(source.id)) {
      throw new Error('source issue ID differs from the existing Multica mapping');
    }
    if (known.metadata?.github_issue_id === undefined) await setMetadata(run, known.id, key, source.id);
    return { key, issue: known, created: false, recovered: false };
  }

  const existing = await findByDescriptionMarker(run, key);
  if (existing) {
    if (existing.metadata?.github_issue_id !== undefined && String(existing.metadata.github_issue_id) !== String(source.id)) {
      throw new Error('source issue ID differs from the existing Multica mapping');
    }
    await setMetadata(run, existing.id, key, source.id);
    return { key, issue: existing, created: false, recovered: true };
  }

  const issue = await createIssue(run, { workDir, project }, source, key);
  await setMetadata(run, issue.id, key, source.id);
  return { key, issue, created: true, recovered: false };
}

async function listImportedCommentMarkers(run, issueId) {
  // No --summary: it clips the body, and the marker is the whole dedupe key.
  const comments = await multicaJson(run, ['issue', 'comment', 'list', issueId, '--roots-only']);
  if (!Array.isArray(comments)) throw new Error('invalid Multica comment list response');
  if (comments.length >= COMMENT_ROOT_CAP) {
    throw new Error(
      `issue ${issueId} has ${comments.length} root comments, the read cap; ` +
      'reconcile this issue by hand rather than risk reposting imported history',
    );
  }
  const markers = new Set();
  for (const comment of comments) {
    for (const line of String(comment.content ?? '').split('\n')) {
      if (line.startsWith(COMMENT_MARKER_PREFIX)) markers.add(line.trim());
    }
  }
  return markers;
}

async function addComment(run, workDir, target, source) {
  const contentFile = await writeBodyFile(workDir, `comment-${source.id}.md`, buildCommentContent({
    key: target.key,
    commentId: source.id,
    id: target.sourceIssueId,
    url: source.html_url,
    author: source.user?.login,
    body: source.body,
  }));
  await run(['multica', 'issue', 'comment', 'add', target.id, '--content-file', contentFile, '--output', 'json']);
}

// The trigger comment is appended to the fetched list when a partial page or a
// deleted comment would otherwise hide it, so the event that woke the workflow
// always lands even when it predates the activation timestamp.
function withTrigger(comments, trigger) {
  if (!trigger || comments.some((comment) => comment.id === trigger.id)) return comments;
  return [...comments, trigger];
}

export async function importEvent({ payload, eventName }, deps) {
  const { run, fetch: httpFetch, cwd = process.cwd(), github = {}, project } = deps;
  const event = readEvent(payload, eventName);
  if (event.kind === 'skip') return { status: 'skipped', reason: event.reason };
  if (event.issue?.pull_request) return { status: 'skipped', reason: 'pull request' };

  const repository = payload.repository?.full_name;
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('invalid event repository.full_name');
  }
  validateIssue(event.issue);
  if (event.kind === 'comment') validateComment(event.comment);

  const workDir = await mkdtemp(path.join(cwd, '.github-import-'));
  try {
    const resolved = await resolveIssue(run, workDir, project, repository, event.issue);
    const summary = {
      status: resolved.created ? 'issue created' : resolved.recovered ? 'issue metadata recovered' : 'up to date',
      key: resolved.key,
      issue: resolved.issue.identifier ?? resolved.issue.id,
    };
    const imported = await listImportedCommentMarkers(run, resolved.issue.id);
    const source = withTrigger(
      await fetchIssueComments(httpFetch, { ...github, repository, number: event.issue.number }),
      event.comment,
    );
    const unique = new Map(source.map((comment) => [comment.id, comment]));
    const missing = [...unique.values()].filter((comment) => !imported.has(commentMarker(resolved.key, comment.id)));
    const target = { id: resolved.issue.id, key: resolved.key, sourceIssueId: event.issue.id };
    for (const comment of missing) {
      await addComment(run, workDir, target, comment);
    }
    return { ...summary, comments: missing.length };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function main({ cwd = process.cwd(), env = process.env, run, httpFetch = fetch } = {}) {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');
  if (!env.MULTICA_TOKEN?.startsWith('mul_') || !env.MULTICA_SERVER_URL || !env.MULTICA_WORKSPACE_ID) {
    throw new Error('configure MULTICA_TOKEN with a mul_ PAT, MULTICA_SERVER_URL, and MULTICA_WORKSPACE_ID');
  }
  // Required, and never defaulted to "now": a rerun has to reconcile against
  // the same boundary it imported the first time.
  const since = Date.parse(env.MULTICA_IMPORT_SINCE ?? '');
  if (Number.isNaN(since) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(env.MULTICA_IMPORT_SINCE ?? '')) {
    throw new Error('MULTICA_IMPORT_SINCE must be an RFC3339 timestamp; it bounds which GitHub comments are imported');
  }
  const raw = JSON.parse(await readFile(eventPath, 'utf8'));
  const result = await importEvent({ payload: raw, eventName: env.GITHUB_EVENT_NAME }, {
    run: run ?? createCommandRunner({ cwd, env }),
    fetch: httpFetch,
    cwd,
    github: { serverUrl: env.GITHUB_API_URL, token: env.GITHUB_TOKEN, since },
    project: env.MULTICA_PROJECT_ID || undefined,
  });
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
