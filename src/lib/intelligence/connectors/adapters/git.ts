import { ConnectorError } from '../http';
import { summarizeDiff } from '../normalize';
import {
  asArray,
  asRecord,
  httpFor,
  type AdapterContext,
  type ChangeRef,
  type ConnectorAdapter,
} from './types';

const SHA = /^[0-9a-f]{7,40}$/i;
const NUMBER = /^\d{1,9}$/;
// A path segment, never "." or "..".
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9_./-]{1,200}$/;

/**
 * Parses the web URL of a commit, pull request, compare view or merge request. Anything else, including
 * URLs with credentials, is rejected; the result only ever contains validated path segments.
 */
export function parseChangeUrl(raw: string): ChangeRef | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  let parts: string[];
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const dash = parts.indexOf('-');
  if (dash > 0) {
    // GitLab: /group/sub/project/-/commit/<sha> or /-/merge_requests/<iid>
    const repository = parts.slice(0, dash);
    const [type, id] = parts.slice(dash + 1);
    if (!repository.every(segment => SEGMENT.test(segment))) return null;
    if (type === 'commit' && id && SHA.test(id))
      return {
        provider: 'gitlab',
        host: url.host,
        repository: repository.join('/'),
        type: 'commit',
        id,
        url: raw,
      };
    if (type === 'merge_requests' && id && NUMBER.test(id))
      return {
        provider: 'gitlab',
        host: url.host,
        repository: repository.join('/'),
        type: 'merge_request',
        id,
        url: raw,
      };
    return null;
  }
  const [owner, repo, type, ...rest] = parts;
  if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  const repository = `${owner}/${repo}`;
  const id = rest.join('/');
  if (type === 'commit' && SHA.test(id))
    return { provider: 'github', host: url.host, repository, type: 'commit', id, url: raw };
  if (type === 'pull' && NUMBER.test(rest[0] ?? ''))
    return { provider: 'github', host: url.host, repository, type: 'pull', id: rest[0], url: raw };
  if (type === 'compare') {
    const pieces = id.split('...');
    if (
      pieces.length === 2 &&
      pieces.every(piece => REF.test(piece) && !piece.includes('..') && !piece.startsWith('/'))
    )
      return { provider: 'github', host: url.host, repository, type: 'compare', id, url: raw };
  }
  return null;
}

/** The web host whose URLs a connection can resolve: github.com for the public API, else the API host. */
export function webHostOf(kind: 'GITHUB' | 'GITLAB', baseUrl: string): string {
  const host = new URL(baseUrl).host;
  return kind === 'GITHUB' && host === 'api.github.com' ? 'github.com' : host;
}

function githubHeaders(context: AdapterContext): Record<string, string> {
  const secret = context.connection.credential.secret;
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
  };
}

const githubFiles = (files: unknown) =>
  asArray(files).map(item => {
    const file = asRecord(item);
    return {
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    };
  });

export const githubAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, githubHeaders(context)).getJson('/rate_limit');
  },

  async diff(context, ref) {
    if (ref.provider !== 'github')
      throw new ConnectorError('UNSUPPORTED', 'Not a GitHub change URL');
    const http = httpFor(context, githubHeaders(context));
    const repo = `/repos/${ref.repository.split('/').map(encodeURIComponent).join('/')}`;
    if (ref.type === 'commit') {
      const body = asRecord(await http.getJson(`${repo}/commits/${ref.id}`));
      const files = githubFiles(body.files);
      return summarizeDiff({
        provider: 'github',
        ref: String(body.sha ?? ref.id).slice(0, 12),
        title: String(asRecord(body.commit).message ?? '').split('\n')[0],
        url: ref.url,
        files,
      });
    }
    if (ref.type === 'pull') {
      const [pull, files] = await Promise.all([
        http.getJson(`${repo}/pulls/${ref.id}`),
        http.getJson(`${repo}/pulls/${ref.id}/files`, { query: { per_page: 30 } }),
      ]);
      const record = asRecord(pull);
      return summarizeDiff({
        provider: 'github',
        ref: `#${ref.id}`,
        title: record.title,
        url: ref.url,
        files: githubFiles(files),
        totalFiles: typeof record.changed_files === 'number' ? record.changed_files : undefined,
      });
    }
    const body = asRecord(
      await http.getJson(
        `${repo}/compare/${ref.id.split('...').map(encodeURIComponent).join('...')}`
      )
    );
    return summarizeDiff({
      provider: 'github',
      ref: ref.id,
      title: `${asArray(body.commits).length} commits`,
      url: ref.url,
      files: githubFiles(body.files),
    });
  },
};

function gitlabHeaders(context: AdapterContext): Record<string, string> {
  const secret = context.connection.credential.secret;
  return secret ? { 'private-token': secret } : {};
}

const gitlabFiles = (diffs: unknown) =>
  asArray(diffs).map(item => {
    const file = asRecord(item);
    return {
      path: file.new_path ?? file.old_path,
      status: file.new_file
        ? 'added'
        : file.deleted_file
          ? 'removed'
          : file.renamed_file
            ? 'renamed'
            : 'modified',
      patch: file.diff,
    };
  });

export const gitlabAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, gitlabHeaders(context)).getJson('/api/v4/version');
  },

  async diff(context, ref) {
    if (ref.provider !== 'gitlab')
      throw new ConnectorError('UNSUPPORTED', 'Not a GitLab change URL');
    const http = httpFor(context, gitlabHeaders(context));
    const project = `/api/v4/projects/${encodeURIComponent(ref.repository)}`;
    if (ref.type === 'commit') {
      const [commit, diffs] = await Promise.all([
        http.getJson(`${project}/repository/commits/${ref.id}`),
        http.getJson(`${project}/repository/commits/${ref.id}/diff`, { query: { per_page: 30 } }),
      ]);
      const record = asRecord(commit);
      return summarizeDiff({
        provider: 'gitlab',
        ref: String(record.short_id ?? ref.id.slice(0, 12)),
        title: record.title,
        url: ref.url,
        files: gitlabFiles(diffs),
      });
    }
    const [request, diffs] = await Promise.all([
      http.getJson(`${project}/merge_requests/${ref.id}`),
      http.getJson(`${project}/merge_requests/${ref.id}/diffs`, { query: { per_page: 30 } }),
    ]);
    return summarizeDiff({
      provider: 'gitlab',
      ref: `!${ref.id}`,
      title: asRecord(request).title,
      url: ref.url,
      files: gitlabFiles(diffs),
    });
  },
};
