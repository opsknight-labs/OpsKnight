import { gunzipSync } from 'node:zlib';
import {
  chunkKnowledgeText,
  cleanKnowledgeText,
  KNOWLEDGE_LIMITS,
  knowledgeContentHash,
  type KnowledgeChunkDraft,
} from '../../memory/contract';

/**
 * Pure rules for the organisation's own documentation sources: where a repository's tarball is fetched from,
 * which archive entries are documents, and how a document becomes knowledge chunks. Nothing here touches the
 * network or the database, so every limit is unit-tested on its own.
 */

export const DOC_SOURCE_LIMITS = {
  archiveBytes: 20 * 1024 * 1024,
  /** Text compresses about five times, so a 20 MB archive of documents never needs more unpacked. */
  unpackedBytes: 100 * 1024 * 1024,
  files: 2_000,
  fileBytes: 1024 * 1024,
  chunksPerFile: 40,
  fetchTimeoutMs: 60_000,
  syncIntervalMs: 6 * 3_600_000,
} as const;

export const DOC_SOURCE_KINDS = ['GIT', 'ARCHIVE'] as const;
export type DocSourceKind = (typeof DOC_SOURCE_KINDS)[number];

/** A failure whose message is safe to show an administrator (it never contains the URL or the token). */
export class DocSourceError extends Error {
  name = 'DocSourceError';
}

const DOC_FILE = /\.(md|mdx|txt)$/i;

/** A folder inside the repository or archive, without surrounding slashes; '' for the root. */
export function normalizeDocFolder(folder: string | null | undefined): string {
  const clean = (folder ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (clean.split('/').includes('..')) throw new DocSourceError('The folder may not contain "..".');
  return clean;
}

interface RepoUrl {
  host: string;
  project: string[];
}

function repoOf(url: string): RepoUrl {
  const parsed = new URL(url);
  const project = parsed.pathname
    .replace(/\.git$/, '')
    .split('/-/')[0]
    .split('/')
    .filter(Boolean);
  if (parsed.protocol !== 'https:' || project.length < 2)
    throw new DocSourceError('Use the https address of a GitHub or GitLab repository.');
  return { host: parsed.host, project };
}

/**
 * The tarball request for a source. github.com goes through its REST API; any other host is treated as GitLab
 * (gitlab.com or self-managed). The token, when given, is sent only to that API host.
 */
export function archiveRequest(
  source: { kind: string; url: string; ref: string | null },
  token: string | null
): { url: string; headers: Record<string, string> } {
  const ref = source.ref?.trim() || null;
  if (source.kind !== 'GIT')
    return { url: source.url, headers: token ? { Authorization: `Bearer ${token}` } : {} };
  const repo = repoOf(source.url);
  if (repo.host === 'github.com') {
    const [owner, name] = repo.project;
    return {
      url: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tarball${ref ? `/${encodeURIComponent(ref)}` : ''}`,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OpsKnight',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
  }
  return {
    url: `https://${repo.host}/api/v4/projects/${encodeURIComponent(repo.project.join('/'))}/repository/archive.tar.gz${ref ? `?sha=${encodeURIComponent(ref)}` : ''}`,
    headers: token ? { 'PRIVATE-TOKEN': token } : {},
  };
}

/** Where a reader opens one document: the file in the repository, or the archive it came from. */
export function documentHref(
  source: { kind: string; url: string; ref: string | null },
  path: string
): string {
  if (source.kind !== 'GIT') return source.url;
  const repo = repoOf(source.url);
  const ref = encodeURIComponent(source.ref?.trim() || 'HEAD');
  const file = path.split('/').map(encodeURIComponent).join('/');
  const base = `https://${repo.host}/${repo.project.join('/')}`;
  return repo.host === 'github.com'
    ? `${base}/blob/${ref}/${file}`
    : `${base}/-/blob/${ref}/${file}`;
}

const cString = (bytes: Buffer) => {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
};

function parseOctal(bytes: Buffer): number | null {
  const text = cString(bytes).trim();
  if (text === '') return 0;
  return /^[0-7]+$/.test(text) ? parseInt(text, 8) : null;
}

/** The `path` record of a PAX extended header, which overrides the next entry's name. */
function paxPath(data: Buffer): string | null {
  for (const record of data.toString('utf8').split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) return match[1];
  }
  return null;
}

function documentPath(
  name: string,
  options: { stripTopFolder: boolean; folder: string }
): string | null {
  let parts = name.split('/').filter(part => part && part !== '.');
  if (parts.includes('..')) return null;
  // Repository tarballs wrap everything in one "<owner>-<repo>-<sha>/" folder.
  if (options.stripTopFolder) parts = parts.slice(1);
  const path = parts.join('/');
  if (!DOC_FILE.test(path)) return null;
  if (options.folder && !path.startsWith(`${options.folder}/`)) return null;
  return path;
}

export interface ExtractedDocument {
  path: string;
  text: string;
}

/**
 * The .md, .mdx and .txt files under `folder` in a (gzipped) tar archive. Read in memory and never written to
 * disk; links, devices and other entry types are skipped. Bounded by DOC_SOURCE_LIMITS: an archive or a
 * document count over the limit fails the sync, a single file over 1 MB is skipped.
 */
export function extractDocuments(
  archive: Buffer,
  options: { stripTopFolder: boolean; folder: string }
): ExtractedDocument[] {
  if (archive.length > DOC_SOURCE_LIMITS.archiveBytes)
    throw new DocSourceError('The archive is larger than 20 MB.');
  let tar: Buffer;
  try {
    tar =
      archive[0] === 0x1f && archive[1] === 0x8b
        ? gunzipSync(archive, { maxOutputLength: DOC_SOURCE_LIMITS.unpackedBytes })
        : archive;
  } catch {
    throw new DocSourceError(
      'The archive could not be unpacked (a .tar.gz up to 100 MB unpacked).'
    );
  }
  const documents: ExtractedDocument[] = [];
  let nextName: string | null = null;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const size = parseOctal(header.subarray(124, 136));
    const start = offset + 512;
    if (size === null || start + size > tar.length)
      throw new DocSourceError('The archive is not a valid tar file.');
    const data = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156]);
    if (type === 'x') {
      nextName = paxPath(data) ?? nextName;
      continue;
    }
    if (type === 'L') {
      nextName = cString(data);
      continue;
    }
    const prefix =
      header.subarray(257, 263).toString('latin1') === 'ustar\0'
        ? cString(header.subarray(345, 500))
        : '';
    const name = nextName ?? (prefix ? `${prefix}/` : '') + cString(header.subarray(0, 100));
    nextName = null;
    if (type !== '0' && type !== '\0') continue;
    const path = documentPath(name, options);
    if (!path || size > DOC_SOURCE_LIMITS.fileBytes) continue;
    const text = data.toString('utf8');
    if (text.includes('\0')) continue;
    if (documents.length >= DOC_SOURCE_LIMITS.files)
      throw new DocSourceError('More than 2,000 documents. Choose a narrower folder.');
    documents.push({ path, text });
  }
  return documents;
}

/** One document as stored chunks: titled by its first heading and path, front matter removed. */
export function documentChunks(path: string, text: string): KnowledgeChunkDraft[] {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const title = cleanKnowledgeText(heading ? `${heading} (${path})` : path, 1_000).slice(
    0,
    KNOWLEDGE_LIMITS.titleChars
  );
  return chunkKnowledgeText(cleanKnowledgeText(body, DOC_SOURCE_LIMITS.fileBytes), {
    maxChunks: DOC_SOURCE_LIMITS.chunksPerFile,
  }).map((chunk, chunkIndex) => ({
    chunkIndex,
    title,
    text: chunk,
    contentHash: knowledgeContentHash(title, chunk),
  }));
}
