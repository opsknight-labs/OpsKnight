import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockAssertCapability,
  mockPrisma,
  mockGetEncryptionKeyringMetadata,
  mockStartEncryptionRun,
  mockCancelEncryptionRun,
  mockEvaluateKeyRetirementReadiness,
  mockEmitAuditEvent,
} = vi.hoisted(() => {
  const mockPrisma = {
    encryptionMigrationRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    mockAssertCapability: vi
      .fn()
      .mockResolvedValue({
        id: 'usr-admin-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'ADMIN',
      }),
    mockPrisma,
    mockGetEncryptionKeyringMetadata: vi.fn().mockResolvedValue({
      activeKeyId: 'k2',
      keys: [{ id: 'k2', source: 'env', isActive: true }],
      totalKeys: 1,
      hasLegacyDbKey: false,
    }),
    mockStartEncryptionRun: vi.fn().mockResolvedValue({
      id: 'run-test-1',
      mode: 'PREVIEW',
      status: 'PENDING',
      registryFingerprint: 'abc123fingerprint',
    }),
    mockCancelEncryptionRun: vi.fn().mockResolvedValue({
      id: 'run-test-1',
      status: 'CANCELLED',
    }),
    mockEvaluateKeyRetirementReadiness: vi.fn().mockResolvedValue({
      evaluatedAt: new Date().toISOString(),
      activeKeyId: 'k2',
      assessments: [],
      allEligibleRetiredFromDatabase: false,
    }),
    mockEmitAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: (...args: unknown[]) => mockAssertCapability(...args),
}));

vi.mock('@/lib/encryption', () => ({
  getEncryptionKeyringMetadata: () => mockGetEncryptionKeyringMetadata(),
}));

vi.mock('@/lib/encryption/worker', () => ({
  startEncryptionRun: (...args: unknown[]) => mockStartEncryptionRun(...args),
  cancelEncryptionRun: (...args: unknown[]) => mockCancelEncryptionRun(...args),
}));

vi.mock('@/lib/encryption/retirement', () => ({
  evaluateKeyRetirementReadiness: (...args: unknown[]) =>
    mockEvaluateKeyRetirementReadiness(...args),
}));

vi.mock('@/lib/audit', () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));

import { GET as getStatus } from '@/app/api/compliance/encryption/status/route';
import { GET as getRuns, POST as postRuns } from '@/app/api/compliance/encryption/runs/route';
import {
  GET as getRunById,
  POST as postRunAction,
} from '@/app/api/compliance/encryption/runs/[id]/route';
import { GET as getRetirementReadiness } from '@/app/api/compliance/encryption/retirement-readiness/route';

describe('Encryption API Routes Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/compliance/encryption/status enforces ENCRYPTION_READ capability', async () => {
    mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue(null);
    mockPrisma.encryptionMigrationRun.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/compliance/encryption/status');
    const res = await getStatus(req);

    expect(res.status).toBe(200);
    expect(mockAssertCapability).toHaveBeenCalledWith('encryption.read');
    const body = await res.json();
    expect(body.data.keyring.activeKeyId).toBe('k2');
    expect(body.data.targetsCount).toBeGreaterThan(0);
  });

  it('POST /api/compliance/encryption/runs enforces ENCRYPTION_MANAGE and starts run', async () => {
    const req = new NextRequest('http://localhost:3000/api/compliance/encryption/runs', {
      method: 'POST',
      body: JSON.stringify({ mode: 'MIGRATE' }),
    });

    const res = await postRuns(req);
    expect(res.status).toBe(201);
    expect(mockAssertCapability).toHaveBeenCalledWith('encryption.manage');
    expect(mockStartEncryptionRun).toHaveBeenCalled();
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ENCRYPTION_MIGRATION_STARTED',
        target: { type: 'ENCRYPTION_MIGRATION', id: 'run-test-1' },
      })
    );
  });

  it('POST /api/compliance/encryption/runs/[id] cancels run and logs audit event', async () => {
    const req = new NextRequest('http://localhost:3000/api/compliance/encryption/runs/run-test-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'cancel' }),
    });

    const res = await postRunAction(req, { params: Promise.resolve({ id: 'run-test-1' }) });
    expect(res.status).toBe(200);
    expect(mockAssertCapability).toHaveBeenCalledWith('encryption.manage');
    expect(mockCancelEncryptionRun).toHaveBeenCalledWith(mockPrisma, 'run-test-1');
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ENCRYPTION_RUN_CANCELLED',
      })
    );
  });

  it('GET /api/compliance/encryption/runs lists runs and enforces ENCRYPTION_READ', async () => {
    mockPrisma.encryptionMigrationRun.findMany.mockResolvedValue([
      { id: 'run-1', mode: 'PREVIEW', status: 'COMPLETED' },
    ]);

    const req = new NextRequest('http://localhost:3000/api/compliance/encryption/runs?limit=10');
    const res = await getRuns(req);

    expect(res.status).toBe(200);
    expect(mockAssertCapability).toHaveBeenCalledWith('encryption.read');
    const body = await res.json();
    expect(body.data.runs).toHaveLength(1);
    expect(body.data.runs[0].id).toBe('run-1');
  });

  it('GET /api/compliance/encryption/runs/[id] returns run details and enforces ENCRYPTION_READ', async () => {
    mockPrisma.encryptionMigrationRun.findUnique.mockResolvedValue({
      id: 'run-test-1',
      mode: 'MIGRATE',
      status: 'RUNNING',
      targetStates: [],
      issues: [],
    });

    const req = new NextRequest('http://localhost:3000/api/compliance/encryption/runs/run-test-1');
    const res = await getRunById(req, { params: Promise.resolve({ id: 'run-test-1' }) });

    expect(res.status).toBe(200);
    expect(mockAssertCapability).toHaveBeenCalledWith('encryption.read');
    const body = await res.json();
    expect(body.data.run.id).toBe('run-test-1');
  });

  it('GET /api/compliance/encryption/retirement-readiness returns assessment report', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/compliance/encryption/retirement-readiness'
    );
    const res = await getRetirementReadiness(req);

    expect(res.status).toBe(200);
    expect(mockAssertCapability).toHaveBeenCalledWith('encryption.read');
    expect(mockEvaluateKeyRetirementReadiness).toHaveBeenCalled();
  });
});
