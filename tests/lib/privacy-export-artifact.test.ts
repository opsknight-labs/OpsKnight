import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const auditCreate = vi.fn();
  const userFindUnique = vi.fn();
  const privacyRequestFindUnique = vi.fn();
  const artifactCreate = vi.fn();
  const artifactFindUnique = vi.fn();
  const artifactUpdate = vi.fn();
  const artifactUpdateMany = vi.fn();
  const artifactFindMany = vi.fn();
  const generateSubjectExport = vi.fn();

  const mockPrisma = {
    auditLog: { create: auditCreate },
    user: { findUnique: userFindUnique },
    privacyRequest: { findUnique: privacyRequestFindUnique },
    privacyExportArtifact: {
      create: artifactCreate,
      findUnique: artifactFindUnique,
      update: artifactUpdate,
      updateMany: artifactUpdateMany,
      findMany: artifactFindMany,
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(mockPrisma)),
  };

  return {
    auditCreate,
    userFindUnique,
    privacyRequestFindUnique,
    artifactCreate,
    artifactFindUnique,
    artifactUpdate,
    artifactUpdateMany,
    artifactFindMany,
    generateSubjectExport,
    mockPrisma,
  };
});

vi.mock('@/lib/prisma', () => ({ default: mocks.mockPrisma }));
vi.mock('@/lib/privacy/export/exporter', () => ({
  generateSubjectExport: mocks.generateSubjectExport,
}));

import {
  createExportArtifact,
  downloadExportArtifact,
  expireArtifact,
  expireDuePrivacyExportArtifacts,
} from '@/lib/privacy/export/artifact';

const ACTOR = { id: 'cactor0000001' };
const REQUEST_ID = 'creq00000001';
const ARTIFACT_ID = 'cartifact0001';

function baseRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: REQUEST_ID,
    subjectType: 'USER',
    subjectId: 'cuserA0000001',
    requestType: 'ACCESS',
    status: 'PROCESSING',
    ...overrides,
  };
}

function baseArtifact(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ARTIFACT_ID,
    requestId: REQUEST_ID,
    status: 'READY',
    encryptedPayload: 'v3:k1:encrypted-stand-in',
    checksum: 'abc123',
    sizeBytes: 42,
    downloadCount: 0,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    lastDownloadedAt: null,
    ...overrides,
  };
}

const ORIGINAL_ENV = { ...process.env };

describe('privacy export artifact lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, ENCRYPTION_KEY: 'a'.repeat(64) };
    mocks.userFindUnique.mockResolvedValue({ email: 'actor@example.com', name: 'Actor' });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('createExportArtifact', () => {
    it('refuses to generate an export for a non-automated request type', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest({ requestType: 'ERASURE' }));

      await expect(createExportArtifact(REQUEST_ID, ACTOR)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(mocks.generateSubjectExport).not.toHaveBeenCalled();
    });

    it('throws PRIVACY_REQUEST_NOT_FOUND for an unknown request', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(null);

      await expect(createExportArtifact(REQUEST_ID, ACTOR)).rejects.toMatchObject({
        code: 'PRIVACY_REQUEST_NOT_FOUND',
      });
    });

    it('creates a READY artifact, never returns the encrypted payload, and audits start+completion', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
      mocks.generateSubjectExport.mockResolvedValue({
        buffer: Buffer.from('zip-bytes'),
        checksum: 'sha256-abc',
        sizeBytes: 9,
      });
      mocks.artifactCreate.mockResolvedValue(baseArtifact());

      const result = await createExportArtifact(REQUEST_ID, ACTOR);

      expect(result).not.toHaveProperty('encryptedPayload');
      expect(mocks.artifactCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestId: REQUEST_ID,
          status: 'READY',
          checksum: 'sha256-abc',
          sizeBytes: 9,
          encryptedPayload: expect.any(String),
        }),
      });

      const actions = mocks.auditCreate.mock.calls.map(call => call[0].data.action);
      expect(actions).toEqual(['privacy.export.started', 'privacy.export.completed']);
    });

    it('records a FAILED artifact and audits privacy.export.failed when generation throws', async () => {
      mocks.privacyRequestFindUnique.mockResolvedValue(baseRequest());
      mocks.generateSubjectExport.mockRejectedValue(new Error('boom'));
      mocks.artifactCreate.mockResolvedValue(
        baseArtifact({ status: 'FAILED', failureReason: 'boom' })
      );

      await expect(createExportArtifact(REQUEST_ID, ACTOR)).rejects.toThrow('boom');

      expect(mocks.artifactCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'FAILED', failureReason: 'boom' }),
      });
      const actions = mocks.auditCreate.mock.calls.map(call => call[0].data.action);
      expect(actions).toEqual(['privacy.export.started', 'privacy.export.failed']);
    });
  });

  describe('downloadExportArtifact', () => {
    it('throws PRIVACY_EXPORT_NOT_FOUND for an unknown artifact', async () => {
      mocks.artifactFindUnique.mockResolvedValue(null);

      await expect(downloadExportArtifact(ARTIFACT_ID, ACTOR)).rejects.toMatchObject({
        code: 'PRIVACY_EXPORT_NOT_FOUND',
      });
    });

    it('expires (and does not decrypt) an artifact past its expiry', async () => {
      mocks.artifactFindUnique.mockResolvedValue(
        baseArtifact({ expiresAt: new Date(Date.now() - 1000) })
      );
      mocks.artifactUpdateMany.mockResolvedValue({ count: 1 });

      await expect(downloadExportArtifact(ARTIFACT_ID, ACTOR)).rejects.toMatchObject({
        code: 'PRIVACY_EXPORT_EXPIRED',
      });
      expect(mocks.artifactUpdateMany).toHaveBeenCalledWith({
        where: { id: ARTIFACT_ID, status: { not: 'EXPIRED' } },
        data: { status: 'EXPIRED', encryptedPayload: null },
      });
    });

    it('rejects downloading a FAILED artifact', async () => {
      mocks.artifactFindUnique.mockResolvedValue(
        baseArtifact({ status: 'FAILED', encryptedPayload: null })
      );

      await expect(downloadExportArtifact(ARTIFACT_ID, ACTOR)).rejects.toMatchObject({
        code: 'PRIVACY_EXPORT_NOT_READY',
      });
    });

    it('decrypts a READY artifact, increments downloadCount, and audits the download', async () => {
      const payloadBuffer = Buffer.from('zip-bytes');

      // The real @/lib/encryption module is used here (not mocked) so this
      // also proves the artifact round-trips through real encrypt/decrypt.
      const { encrypt } = await import('@/lib/encryption');
      const encryptedPayload = await encrypt(payloadBuffer.toString('base64'));
      mocks.artifactFindUnique.mockResolvedValue(baseArtifact({ encryptedPayload }));
      mocks.artifactUpdate.mockResolvedValue(
        baseArtifact({ status: 'DOWNLOADED', downloadCount: 1 })
      );

      const result = await downloadExportArtifact(ARTIFACT_ID, ACTOR);

      expect(result.buffer.toString()).toBe('zip-bytes');
      expect(mocks.artifactUpdate).toHaveBeenCalledWith({
        where: { id: ARTIFACT_ID },
        data: expect.objectContaining({ status: 'DOWNLOADED', downloadCount: { increment: 1 } }),
      });
      const actions = mocks.auditCreate.mock.calls.map(call => call[0].data.action);
      expect(actions).toEqual(['privacy.export.downloaded']);
      // Never log the actual export bytes/content, only checksum/id metadata.
      const auditDetails = JSON.stringify(mocks.auditCreate.mock.calls[0][0]);
      expect(auditDetails).not.toContain('zip-bytes');
    });
  });

  describe('expireArtifact', () => {
    it('is idempotent: a second call is a safe no-op with no duplicate audit event', async () => {
      mocks.artifactUpdateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const first = await expireArtifact(ARTIFACT_ID);
      const second = await expireArtifact(ARTIFACT_ID);

      expect(first).toBe(true);
      expect(second).toBe(false);
      const actions = mocks.auditCreate.mock.calls.map(call => call[0].data.action);
      expect(actions).toEqual(['privacy.export.expired']);
    });
  });

  describe('expireDuePrivacyExportArtifacts', () => {
    it('sweeps only due, non-expired artifacts and reports the count', async () => {
      mocks.artifactFindMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
      mocks.artifactUpdateMany.mockResolvedValue({ count: 1 });

      const count = await expireDuePrivacyExportArtifacts(new Date('2026-09-16T00:00:00.000Z'));

      expect(count).toBe(2);
      expect(mocks.artifactFindMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lte: new Date('2026-09-16T00:00:00.000Z') },
          status: { not: 'EXPIRED' },
        },
        select: { id: true },
        take: 500,
      });
    });
  });
});
