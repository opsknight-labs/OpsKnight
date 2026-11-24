import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveRequest,
  DOC_SOURCE_LIMITS,
  documentChunks,
  documentHref,
  extractDocuments,
  normalizeDocFolder,
} from '@/lib/intelligence/knowledge/doc-sources/archive';
import { downloadArchive } from '@/lib/intelligence/knowledge/doc-sources/service';

/** One ustar entry: a 512-byte header (name, size, type, magic) and its data padded to 512 bytes. */
function entry(name: string, content: string | Buffer, type = '0'): Buffer {
  const data = typeof content === 'string' ? Buffer.from(content) : content;
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0);
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write(type, 156);
  header.write('ustar\0', 257, 'latin1');
  header.write('00', 263);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

const pax = (path: string) => {
  const record = ` path=${path}\n`;
  return entry('PaxHeader', `${record.length + String(record.length).length}${record}`, 'x');
};

const tar = (...entries: Buffer[]) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
const repo = { stripTopFolder: true, folder: 'docs' };

describe('documentation archive extraction', () => {
  it('keeps only .md, .mdx and .txt files under the folder of a repository tarball', () => {
    const longPath = `acme-runbooks-abc123/docs/${'deep/'.repeat(30)}guide.md`;
    const documents = extractDocuments(
      tar(
        entry('pax_global_header', '52 comment=abc123\n', 'g'),
        entry('acme-runbooks-abc123/', '', '5'),
        entry('acme-runbooks-abc123/docs/db.md', '# Database\nRestart the primary.'),
        entry('acme-runbooks-abc123/docs/api.mdx', 'API notes'),
        entry('acme-runbooks-abc123/docs/notes.TXT', 'plain notes'),
        entry('acme-runbooks-abc123/docs/logo.png', 'png'),
        entry('acme-runbooks-abc123/src/readme.md', 'outside the folder'),
        entry('acme-runbooks-abc123/docs/link.md', '', '2'),
        entry('acme-runbooks-abc123/docs/../../etc/passwd.md', 'traversal'),
        entry('acme-runbooks-abc123/docs/binary.md', Buffer.from([0x61, 0x00, 0x62])),
        entry(
          'acme-runbooks-abc123/docs/huge.md',
          Buffer.alloc(DOC_SOURCE_LIMITS.fileBytes + 1, 97)
        ),
        pax(longPath),
        entry('truncated-name', 'deep guide'),
        entry('././@LongLink', 'acme-runbooks-abc123/docs/gnu-long.md\0', 'L'),
        entry('cut', 'gnu guide')
      ),
      repo
    );
    expect(documents.map(document => document.path)).toEqual([
      'docs/db.md',
      'docs/api.mdx',
      'docs/notes.TXT',
      longPath.slice('acme-runbooks-abc123/'.length),
      'docs/gnu-long.md',
    ]);
    expect(documents[0].text).toBe('# Database\nRestart the primary.');
  });

  it('reads an archive from its root without stripping a folder, gzipped or not', () => {
    const plain = Buffer.concat([
      entry('handbook/on-call.md', 'Page the lead.'),
      Buffer.alloc(1024),
    ]);
    expect(extractDocuments(plain, { stripTopFolder: false, folder: '' })).toEqual([
      { path: 'handbook/on-call.md', text: 'Page the lead.' },
    ]);
    expect(extractDocuments(plain, { stripTopFolder: false, folder: 'other' })).toEqual([]);
  });

  it('refuses archives over the size and document limits and malformed archives', () => {
    expect(() => extractDocuments(Buffer.alloc(DOC_SOURCE_LIMITS.archiveBytes + 1), repo)).toThrow(
      'larger than 20 MB'
    );
    const many = Array.from({ length: DOC_SOURCE_LIMITS.files + 1 }, (_, index) =>
      entry(`root/docs/page-${index}.md`, 'x')
    );
    expect(() => extractDocuments(tar(...many), repo)).toThrow('More than 2,000 documents');
    expect(extractDocuments(tar(...many.slice(0, DOC_SOURCE_LIMITS.files)), repo)).toHaveLength(
      DOC_SOURCE_LIMITS.files
    );
    const broken = entry('root/docs/a.md', 'hello').subarray(0, 515);
    expect(() => extractDocuments(broken, repo)).toThrow('not a valid tar file');
    expect(() => extractDocuments(Buffer.from([0x1f, 0x8b, 1, 2, 3]), repo)).toThrow(
      'could not be unpacked'
    );
  });

  it('rejects a folder that climbs out of the archive', () => {
    expect(normalizeDocFolder('/docs/runbooks/')).toBe('docs/runbooks');
    expect(() => normalizeDocFolder('docs/../..')).toThrow('".."');
  });
});

describe('documentation source addresses', () => {
  it('fetches GitHub through its API and anything else as GitLab, sending the token only there', () => {
    expect(
      archiveRequest({ kind: 'GIT', url: 'https://github.com/acme/runbooks.git', ref: 'main' }, 't')
    ).toEqual({
      url: 'https://api.github.com/repos/acme/runbooks/tarball/main',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OpsKnight',
        Authorization: 'Bearer t',
      },
    });
    expect(
      archiveRequest(
        { kind: 'GIT', url: 'https://gitlab.example.com/ops/team/docs/-/tree/main', ref: null },
        't'
      )
    ).toEqual({
      url: 'https://gitlab.example.com/api/v4/projects/ops%2Fteam%2Fdocs/repository/archive.tar.gz',
      headers: { 'PRIVATE-TOKEN': 't' },
    });
    expect(() =>
      archiveRequest({ kind: 'GIT', url: 'https://github.com/acme', ref: null }, null)
    ).toThrow('https address of a GitHub or GitLab repository');
  });

  it('links each document to its file in the repository', () => {
    expect(
      documentHref(
        { kind: 'GIT', url: 'https://github.com/acme/runbooks', ref: 'v2' },
        'docs/db.md'
      )
    ).toBe('https://github.com/acme/runbooks/blob/v2/docs/db.md');
    expect(
      documentHref({ kind: 'GIT', url: 'https://gitlab.com/ops/docs', ref: null }, 'a b.md')
    ).toBe('https://gitlab.com/ops/docs/-/blob/HEAD/a%20b.md');
    expect(
      documentHref({ kind: 'ARCHIVE', url: 'https://cdn.example.com/docs.tgz', ref: null }, 'a.md')
    ).toBe('https://cdn.example.com/docs.tgz');
  });

  it('titles chunks by heading and path, without front matter', () => {
    const [first] = documentChunks(
      'docs/db.md',
      '---\nowner: dba\n---\n# Database failover\nPromote the replica.'
    );
    expect(first.title).toBe('Database failover (docs/db.md)');
    expect(first.text).not.toContain('owner: dba');
    expect(first.text).toContain('Promote the replica.');
  });
});

describe('documentation download', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('refuses plain HTTP, private and loopback addresses and embedded credentials', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const url of [
      'http://example.com/docs.tar.gz',
      'https://127.0.0.1/docs.tar.gz',
      'https://10.0.0.8/docs.tar.gz',
      'https://[::1]/docs.tar.gz',
      'https://user:secret@example.com/docs.tar.gz',
    ])
      await expect(downloadArchive(url, {})).rejects.toThrow('Only HTTPS addresses');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows a redirect to another host without the token and enforces the size limit', async () => {
    vi.stubEnv('OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS', 'api.docs.test,dl.docs.test');
    const seen: Array<{ url: string; headers: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, init: RequestInit) => {
        seen.push({ url: url.toString(), headers: init.headers });
        return url.host === 'api.docs.test'
          ? new Response(null, { status: 302, headers: { location: 'https://dl.docs.test/x.tgz' } })
          : new Response('archive-bytes');
      })
    );
    const body = await downloadArchive('https://api.docs.test/tarball', {
      Authorization: 'Bearer t',
    });
    expect(body.toString()).toBe('archive-bytes');
    expect(seen).toEqual([
      { url: 'https://api.docs.test/tarball', headers: { Authorization: 'Bearer t' } },
      { url: 'https://dl.docs.test/x.tgz', headers: {} },
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('x', {
            headers: { 'content-length': String(DOC_SOURCE_LIMITS.archiveBytes + 1) },
          })
      )
    );
    await expect(downloadArchive('https://dl.docs.test/x.tgz', {})).rejects.toThrow(
      'larger than 20 MB'
    );
  });
});
