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

// `mention://agent/<uuid>` and `mention://squad/<uuid>` enqueue a run when a
// comment is posted, so a pasted link from a public issue would spend an agent
// run. Rewriting the scheme keeps the text readable and inert. A plain `@` is
// not a Multica mention, but GitHub renders it as a ping, so it becomes U+FF20
// FULLWIDTH COMMERCIAL AT on the way in.
const MENTION_SCHEME = /mention:\/\//gi;
const AT_SIGN = /@/g;
// The importer reads markers back out of imported bodies, so an external body
// that contains marker-shaped text would otherwise register as a dedupe
// record. Bracketing the prefixes keeps the text readable and unmatchable.
const MARKER_PREFIX = /\b(git(hub)?-(source|comment)):/g;

const GITHUB_PAGE_SIZE = 100;
// Ten pages bounds a runaway issue without hiding a real backlog; the issue
// importer only ever runs on a live comment event, so this is generous.
const GITHUB_MAX_PAGES = 10;
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
    .replace(MENTION_SCHEME, 'mention+')
    .replace(MARKER_PREFIX, '[$1]:')
    .replace(AT_SIGN, '＠');
}

// A plaintext fence long enough to outlast the source text renders the import
// as inert quoted text, so a mermaid diagram or an html card in the original
// body cannot become a live one here.
function quoteSource(text) {
  const longest = Array.from(text.matchAll(/`+/g), (match) => match[0].length)
    .reduce((longestSoFar, length) => Math.max(longestSoFar, length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function provenance(key, { id, url, author }) {
  return [
    `GitHub issue: ${key} (id ${id})`,
    `Source: ${url}`,
    `Author: ${sanitizeExternalText(author)}`,
  ].join('\n');
}

export function buildIssueDescription({ key, id, url, author, body }) {
  const text = sanitizeExternalText(body).trim() || '_No description provided._';
  return `${quoteSource(text)}\n\n---\n\n${issueMarker(key)}\n${provenance(key, { id, url, author })}\n`;
}

// `/note` as the first whitespace-delimited token is Multica's own opt-out: the
// comment is stored and rendered normally but never enqueues an agent, which
// keeps an imported GitHub comment inert even after a human assigns the issue.
export function buildCommentContent({ key, commentId, id, url, author, body }) {
  const text = sanitizeExternalText(body).trim() || '_No comment body._';
  const source = [commentMarker(key, commentId), provenance(key, { id, url, author })].join('\n');
  return `/note Imported from GitHub.\n\n${quoteSource(text)}\n\n---\n\n${source}\n`;
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
  return `${base}/repos/${encodeURIComponent(repository)}/issues/${number}/comments?per_page=${GITHUB_PAGE_SIZE}&page=${page}`;
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
    comments.push(...batch);
    if (batch.length < GITHUB_PAGE_SIZE) break;
  }
  return since ? comments.filter((comment) => createdAt(comment) >= since) : comments;
}

function createdAt(comment) {
  const parsed = Date.parse(comment.created_at ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function createCommandRunner({ cwd = process.cwd() } = {}) {
  // No shell anywhere: every Multica invocation is an argument vector, so a
  // title or comment body can never reach an interpreter.
  return async (args) => {
    const { stdout, stderr } = await execFileAsync(args[0], args.slice(1), {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr };
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
  const issues = page?.issues ?? [];
  if (issues.length > 1) {
    throw new Error(`${key} is mapped to ${issues.length} Multica issues; resolve the duplicate before importing again`);
  }
  return issues[0] ?? null;
}

// Metadata is written after the issue exists, so a failure in between leaves an
// issue the next run has to recognise. The body marker is the fallback.
async function findByDescriptionMarker(run, key) {
  const marker = issueMarker(key);
  const result = await multicaJson(run, [
    'issue', 'search', marker, '--include-closed', '--limit', '20',
  ]);
  const matches = (result?.issues ?? []).filter((issue) => String(issue.description ?? '').includes(marker));
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
  ];
  if (project) args.push('--project', project);
  return multicaJson(run, args);
}

async function resolveIssue(run, workDir, project, repository, source) {
  const key = issueKey(repository, source.number);
  const known = await findByMetadata(run, key);
  if (known) return { key, issue: known, created: false, recovered: false };

  const existing = await findByDescriptionMarker(run, key);
  if (existing) {
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
  if (Array.isArray(comments) && comments.length >= COMMENT_ROOT_CAP) {
    throw new Error(
      `issue ${issueId} has ${comments.length} root comments, the read cap; ` +
      'reconcile this issue by hand rather than risk reposting imported history',
    );
  }
  const markers = new Set();
  for (const comment of Array.isArray(comments) ? comments : []) {
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

  const repository = payload.repository?.full_name;
  if (!repository) throw new Error('event payload is missing repository.full_name');
  if (!event.issue?.number) throw new Error('event payload is missing the source issue');

  const workDir = await mkdtemp(path.join(cwd, '.github-import-'));
  try {
    const resolved = await resolveIssue(run, workDir, project, repository, event.issue);
    const summary = {
      status: resolved.created ? 'issue created' : resolved.recovered ? 'issue metadata recovered' : 'up to date',
      key: resolved.key,
      issue: resolved.issue.identifier ?? resolved.issue.id,
    };
    if (event.kind === 'issue') return summary;

    const imported = await listImportedCommentMarkers(run, resolved.issue.id);
    const source = withTrigger(
      await fetchIssueComments(httpFetch, { ...github, repository, number: event.issue.number }),
      event.comment,
    );
    const missing = source.filter((comment) => !imported.has(commentMarker(resolved.key, comment.id)));
    const target = { id: resolved.issue.id, key: resolved.key, sourceIssueId: event.issue.id };
    for (const comment of missing) {
      await addComment(run, workDir, target, comment);
    }
    return { ...summary, comments: missing.length };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function main({ cwd = process.cwd(), env = process.env } = {}) {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');
  // Required, and never defaulted to "now": a rerun has to reconcile against
  // the same boundary it imported the first time.
  const since = Date.parse(env.MULTICA_IMPORT_SINCE ?? '');
  if (Number.isNaN(since)) {
    throw new Error('MULTICA_IMPORT_SINCE must be an RFC3339 timestamp; it bounds which GitHub comments are imported');
  }
  const raw = JSON.parse(await readFile(eventPath, 'utf8'));
  const result = await importEvent(raw, {
    run: createCommandRunner({ cwd }),
    fetch,
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
