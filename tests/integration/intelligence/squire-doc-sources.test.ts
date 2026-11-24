import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/lib/authorization';
import {
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

// Only the session is replaced; the actions, the sync, the search and the database are real.
const session = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock('@/lib/rbac', async () => {
  const authorization = await import('@/lib/authorization');
  return {
    assertCapability: async (capability: string) => {
      const user = session.user;
      if (!user || !authorization.hasCapability(user.role as AppRole, capability as never)) {
        throw new authorization.AuthorizationError('Unauthorized.', capability as never);
      }
      return user;
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  addDocSourceAction,
  deleteDocSourceAction,
  syncDocSourceAction,
} from '@/app/(app)/settings/intelligence/ai/docs/actions';
import { resolveUserActor } from '@/lib/authorization-actors';
import { decrypt } from '@/lib/encryption';
import { searchDocumentsForActor } from '@/lib/intelligence/knowledge/doc-sources/service';
import { updateSquireMemorySettings } from '@/lib/intelligence/memory/settings';
import { buildKnowledgeTools } from '@/lib/intelligence/squire/tools-knowledge';

const initial = { message: '', ok: false };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function entry(name: string, content: string): Buffer {
  const data = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0);
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('0', 156);
  header.write('ustar\0', 257, 'latin1');
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

/** A repository tarball as GitHub serves it, with the given files under one top folder. */
const tarball = (files: Record<string, string>) =>
  gzipSync(
    Buffer.concat([
      ...Object.entries(files).map(([path, text]) => entry(`acme-runbooks-1a2b/${path}`, text)),
      Buffer.alloc(1024),
    ])
  );

let served: Buffer = Buffer.alloc(0);

async function signIn(role: AppRole, teamId?: string) {
  const user = await createTestUser({
    role,
    ...(teamId ? { teamMemberships: { create: { teamId } } } : {}),
  });
  session.user = { id: user.id, role };
  return user;
}

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  session.user = null;
  // api.github.com resolves without DNS in tests; the tarball comes from the stubbed fetch.
  vi.stubEnv('OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS', 'api.github.com');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array(served)))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('documentation source actions', () => {
  it('refuses people without the intelligence management permission', async () => {
    await signIn('USER');
    for (const outcome of [
      await addDocSourceAction(
        initial,
        form({ name: 'Docs', kind: 'GIT', url: 'https://github.com/acme/runbooks' })
      ),
      await syncDocSourceAction(initial, form({ id: 'x' })),
      await deleteDocSourceAction(initial, form({ id: 'x' })),
    ])
      expect(outcome).toEqual({ ok: false, message: 'Unauthorized.' });
    expect(await db.knowledgeDocSource.count()).toBe(0);
  });

  it('lets an administrator add a source with an encrypted token, sync it and remove it', async () => {
    const admin = await signIn('ADMIN');
    expect(
      await addDocSourceAction(
        initial,
        form({ name: 'Docs', kind: 'GIT', url: 'http://github.com/acme/runbooks' })
      )
    ).toEqual({ ok: false, message: 'The address must start with https://' });
    expect(
      await addDocSourceAction(
        initial,
        form({
          name: 'Runbooks',
          kind: 'GIT',
          url: 'https://github.com/acme/runbooks',
          ref: 'main',
          path: '/docs/',
          token: 'ghp_secret_token',
        })
      )
    ).toMatchObject({ ok: true });
    const row = await db.knowledgeDocSource.findFirstOrThrow();
    expect(row).toMatchObject({ kind: 'GIT', ref: 'main', path: 'docs', createdById: admin.id });
    expect(row.tokenEncrypted).not.toContain('ghp_secret_token');
    expect(await decrypt(row.tokenEncrypted!)).toBe('ghp_secret_token');
    expect(await db.auditLog.count({ where: { action: 'intelligence.doc_source.created' } })).toBe(
      1
    );

    served = tarball({ 'docs/a.md': '# A\nalpha', 'README.md': 'outside the folder' });
    expect(await syncDocSourceAction(initial, form({ id: row.id }))).toEqual({
      ok: true,
      message: 'Synced 1 documents.',
    });
    const [request] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit];
    expect(request.toString()).toBe('https://api.github.com/repos/acme/runbooks/tarball/main');

    expect(await deleteDocSourceAction(initial, form({ id: row.id }))).toEqual({
      ok: true,
      message: 'Source removed.',
    });
    expect(await db.knowledgeDocSource.count()).toBe(0);
    expect(await db.knowledgeChunk.count()).toBe(0);
  });

  it('records a failed sync on the source without leaking the address', async () => {
    await signIn('ADMIN');
    await addDocSourceAction(
      initial,
      form({ name: 'Docs', kind: 'GIT', url: 'https://github.com/acme/runbooks' })
    );
    const { id } = await db.knowledgeDocSource.findFirstOrThrow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 }))
    );
    expect(await syncDocSourceAction(initial, form({ id }))).toEqual({
      ok: false,
      message: 'The server answered HTTP 404.',
    });
    expect(await db.knowledgeDocSource.findUniqueOrThrow({ where: { id } })).toMatchObject({
      lastStatus: 'FAILED',
      lastError: 'The server answered HTTP 404.',
    });
  });
});

describe('documentation search', () => {
  it('replaces chunks on each sync and only shows a team source to that team', async () => {
    const payments = await createTestTeam('Payments');
    const admin = await signIn('ADMIN');
    await updateSquireMemorySettings({ knowledgeEnabled: true, expectedRevision: 0 }, admin.id);
    await addDocSourceAction(
      initial,
      form({
        name: 'Payments runbooks',
        kind: 'GIT',
        url: 'https://github.com/acme/runbooks',
        teamId: payments.id,
      })
    );
    const source = await db.knowledgeDocSource.findFirstOrThrow();

    served = tarball({
      'docs/failover.md': '# Database failover\nPromote the replica when the primary is down.',
      'docs/legacy.md': '# Legacy\nThe replica used to be promoted by hand.',
    });
    expect(await syncDocSourceAction(initial, form({ id: source.id }))).toMatchObject({ ok: true });
    const first = await db.knowledgeChunk.findMany({ where: { sourceKind: 'DOCUMENT' } });
    expect(first.map(chunk => chunk.sourceId).sort()).toEqual([
      `${source.id}/docs/failover.md`,
      `${source.id}/docs/legacy.md`,
    ]);
    expect(first.every(chunk => chunk.teamId === payments.id)).toBe(true);

    served = tarball({
      'docs/failover.md': '# Database failover\nPromote the replica when the primary is down.',
    });
    await syncDocSourceAction(initial, form({ id: source.id }));
    const second = await db.knowledgeChunk.findMany({ where: { sourceKind: 'DOCUMENT' } });
    // The unchanged file keeps its row (and so its embedding); the removed file's chunks are gone.
    expect(second.map(chunk => chunk.id)).toEqual(
      first.filter(chunk => chunk.sourceId.endsWith('failover.md')).map(chunk => chunk.id)
    );
    expect(
      await db.knowledgeDocSource.findUniqueOrThrow({ where: { id: source.id } })
    ).toMatchObject({ lastStatus: 'OK', documentCount: 1, lastError: null });

    const member = await createTestUser({
      role: 'USER',
      teamMemberships: { create: { teamId: payments.id } },
    });
    const outsider = await createTestUser({ role: 'USER' });
    const [hit] = await searchDocumentsForActor(await actorOf(member.id), 'replica');
    expect(hit).toMatchObject({
      kind: 'DOCUMENT',
      title: 'Database failover (docs/failover.md)',
      source: {
        kind: 'document',
        id: source.id,
        name: 'Payments runbooks',
        path: 'docs/failover.md',
        href: 'https://github.com/acme/runbooks/blob/HEAD/docs/failover.md',
      },
    });
    expect(await searchDocumentsForActor(await actorOf(outsider.id), 'replica')).toEqual([]);

    // Squire's knowledge tool returns the passage with its citation.
    const [tool] = buildKnowledgeTools(await actorOf(member.id), { personal: false });
    const result = (await tool.execute!({ query: 'replica' })) as { items: unknown[] };
    expect(result.items).toEqual([
      expect.objectContaining({ kind: 'DOCUMENT', source: expect.objectContaining(hit.source) }),
    ]);
    expect(await tool.execute!({ query: 'replica', kinds: ['POSTMORTEM'] })).toMatchObject({
      items: [],
    });

    // Everyone reads a source with no team; nobody reads a disabled one.
    await db.knowledgeDocSource.update({ where: { id: source.id }, data: { teamId: null } });
    expect(await searchDocumentsForActor(await actorOf(outsider.id), 'replica')).toHaveLength(1);
    await db.knowledgeDocSource.update({ where: { id: source.id }, data: { enabled: false } });
    expect(await searchDocumentsForActor(await actorOf(member.id), 'replica')).toEqual([]);
  });
});
