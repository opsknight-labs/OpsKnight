import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { Prisma, RunbookVersion } from '@prisma/client';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';

const mocks = vi.hoisted(() => ({
  actor: {
    id: 'admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    teamIds: [],
    apiKey: { id: 'key', scopes: ['runbooks:write', 'runbooks:publish'] },
  } as AuthorizationActor,
  tx: {
    runbook: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    runbookVersion: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    runbookInput: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
  audit: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: mocks.tx }));
vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: mocks.transaction }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/api-v2/auth', () => ({
  authenticateV2Request: vi.fn(async () => ({ actor: mocks.actor, apiKey: mocks.actor.apiKey })),
}));
vi.mock('@/lib/api-v2/rate-limit', () => ({ enforceV2RateLimit: vi.fn(async () => ({})) }));
vi.mock('@/lib/api-v2/idempotency', () => ({
  runV2IdempotentMutation: vi.fn(async (_req, _id, _scope, _body, execute) => ({
    value: await execute(mocks.tx),
    replayed: false,
  })),
  idempotencyResponseHeaders: vi.fn(() => ({})),
}));

import { PATCH, GET } from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/route';
import { POST as publish } from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/publish/route';
import { POST as validate } from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/validate/route';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { projectAuthoringVersion } from '@/lib/api-v2/runbook-authoring';

const runbookId = 'cmv7kbd0l000dxlzuo1cmhu1e';
const versionId = 'cmv7kbd0l000exlzuo1cmhu1e';
const definition = parseRunbookDefinition({
  steps: [{ key: 'verify', name: 'Verify recovery', type: 'MANUAL', config: {} }],
});
function draft() {
  return {
    id: versionId,
    runbookId,
    version: 1,
    state: 'DRAFT',
    definition,
    checksum: computeDefinitionChecksum(definition),
    draftRevision: 3,
    inputs: [],
    runbook: { id: runbookId, archivedAt: null, publishedVersionId: null },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    publishedAt: null,
  };
}
type Handler = (
  req: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>;
function call(
  handler: Handler,
  body: unknown = {},
  options: { etag?: string | null; key?: string | null; method?: string; parent?: string } = {}
) {
  return handler(
    new NextRequest('http://localhost/api/v2/runbooks/r/drafts/v', {
      method: options.method ?? 'POST',
      headers: {
        ...(options.etag === null ? {} : { 'if-match': options.etag ?? '"3"' }),
        ...(options.key === null ? {} : { 'idempotency-key': options.key ?? 'one-request' }),
      },
      ...(options.method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: options.parent ?? runbookId, versionId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor = {
    id: 'admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    teamIds: [],
    apiKey: { id: 'key', scopes: ['runbooks:write', 'runbooks:publish'] },
  };
  mocks.tx.runbook.findUnique.mockResolvedValue({ id: runbookId, archivedAt: null });
  mocks.tx.runbookVersion.findFirst.mockResolvedValue(draft());
  mocks.tx.runbookVersion.findUnique.mockResolvedValue(draft());
  mocks.tx.runbookVersion.findUniqueOrThrow.mockResolvedValue({ ...draft(), draftRevision: 4 });
  mocks.tx.runbookVersion.updateMany.mockResolvedValue({ count: 1 });
  mocks.audit.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(execute => execute(mocks.tx));
});

describe('runbook authoring REST boundaries', () => {
  it('requires If-Match before any draft write', async () => {
    const response = await call(PATCH, { definition }, { method: 'PATCH', etag: null });
    expect(response.status).toBe(428);
    expect(mocks.tx.runbookVersion.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.runbookVersion.updateMany).not.toHaveBeenCalled();
  });
  it('rejects stale draft revisions without mutating the draft', async () => {
    const response = await call(PATCH, { definition }, { method: 'PATCH', etag: '"2"' });
    expect(response.status).toBe(412);
    expect(mocks.tx.runbookVersion.updateMany).not.toHaveBeenCalled();
  });
  it('checks the version belongs to the URL parent in the transaction', async () => {
    mocks.tx.runbookVersion.findFirst.mockResolvedValue(null);
    expect((await call(PATCH, { definition }, { method: 'PATCH' })).status).toBe(404);
    expect(mocks.tx.runbookVersion.findFirst).toHaveBeenCalledWith({
      where: { id: versionId, runbookId },
    });
    expect(mocks.tx.runbookVersion.updateMany).not.toHaveBeenCalled();
  });
  it('rejects unrecognized fields and requires a retry key', async () => {
    expect(
      (await call(PATCH, { definition, bypassApproval: true }, { method: 'PATCH' })).status
    ).toBe(400);
    expect((await call(PATCH, { definition }, { method: 'PATCH', key: null })).status).toBe(400);
    expect(mocks.tx.runbookVersion.updateMany).not.toHaveBeenCalled();
  });
  it('updates via the UI command and writes the audit on the outer transaction', async () => {
    const response = await call(PATCH, { definition }, { method: 'PATCH' });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"4"');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.tx.runbookVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: versionId, state: 'DRAFT', draftRevision: 3 },
      })
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'API',
        actorId: 'admin',
        action: 'runbook.version.edited',
        details: { apiClientId: 'key' },
      }),
      mocks.tx
    );
  });
  it('does not authorize publishing with only an authoring scope or broad admin scope', async () => {
    for (const scopes of [['runbooks:write'], ['admin:manage']]) {
      mocks.actor.apiKey = { id: 'key', scopes };
      expect((await call(publish)).status).toBe(403);
    }
    expect(mocks.tx.runbookVersion.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.runbookVersion.updateMany).not.toHaveBeenCalled();
  });
  it('publishes with a changed revision using the shared publication command', async () => {
    mocks.tx.runbookVersion.findUniqueOrThrow.mockResolvedValue({
      ...draft(),
      state: 'PUBLISHED',
      draftRevision: 4,
    });
    const response = await call(publish);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"4"');
    expect(mocks.tx.runbookVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'PUBLISHED', draftRevision: { increment: 1 } }),
      })
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('validates a draft without writing, publishing, or scheduling execution', async () => {
    const response = await call(validate);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      valid: true,
      versionId,
      draftRevision: 3,
    });
    expect(mocks.tx.runbookVersion.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('applies the parent filter to draft reads', async () => {
    mocks.tx.runbookVersion.findFirst.mockResolvedValue(null);
    expect((await call(GET, undefined, { method: 'GET' })).status).toBe(404);
    expect(mocks.tx.runbookVersion.findFirst).toHaveBeenCalledWith({
      where: { id: versionId, runbookId, state: 'DRAFT' },
    });
  });
  it('never returns executable configuration or input defaults', () => {
    const result = projectAuthoringVersion({
      ...draft(),
      definition: {
        steps: [
          {
            key: 'secret',
            name: 'Check',
            type: 'BASH',
            config: { command: 'SECRET_MARKER', password: 'PASSWORD_MARKER' },
          },
        ],
      },
    } as unknown as RunbookVersion);
    const json = JSON.stringify(result);
    expect(json).not.toContain('SECRET_MARKER');
    expect(json).not.toContain('PASSWORD_MARKER');
    expect(json).not.toContain('definition');
    expect(json).not.toContain('config');
  });
});

describe('shared versioning transactions', () => {
  it('joins an existing transaction when creating a runbook and its first draft', async () => {
    mocks.tx.runbook.create.mockResolvedValue({ id: runbookId, name: 'Verify' });
    mocks.tx.runbookVersion.create.mockResolvedValue(draft());
    await createRunbook(
      { name: 'Verify', slug: 'verify', description: '' },
      { id: 'admin', apiKeyId: 'key' },
      mocks.tx as unknown as Prisma.TransactionClient
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'runbook.created', source: 'API' }),
      mocks.tx
    );
  });
  it('uses a serializable transaction and retains UI audit attribution for existing callers', async () => {
    await publishDraftVersion(versionId, 'admin');
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'runbook.version.published', actorId: 'admin' }),
      mocks.tx
    );
    expect(mocks.audit.mock.calls[0][0]).not.toHaveProperty('source');
  });
  it('refuses publication if the stored checksum was tampered with', async () => {
    mocks.tx.runbookVersion.findUnique.mockResolvedValue({ ...draft(), checksum: 'tampered' });
    await expect(publishDraftVersion(versionId, 'admin')).rejects.toThrow(/checksum/);
    expect(mocks.tx.runbookVersion.updateMany).not.toHaveBeenCalled();
  });
  it('propagates audit failures to the owner of the transaction', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      publishDraftVersion(
        versionId,
        { id: 'admin', apiKeyId: 'key' },
        mocks.tx as unknown as Prisma.TransactionClient
      )
    ).rejects.toThrow('audit unavailable');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
