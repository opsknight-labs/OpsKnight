// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { evaluateControl } from '@/lib/compliance/evaluation/engine';
import { complianceEvaluatorRegistry } from '@/lib/compliance/evaluators';

vi.mock('@/lib/audit', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('compliance evaluation engine (unit)', () => {
  let mockPrisma: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      complianceEvaluation: {
        create: vi.fn().mockImplementation(({ data }: any) => ({
          id: `eval_${Math.random().toString(36).slice(2, 8)}`,
          ...data,
          createdAt: new Date(),
        })),
        findMany: vi.fn().mockResolvedValue([]),
      },
      complianceControlState: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: any) => ({
          ...data,
          updatedAt: new Date(),
        })),
        update: vi.fn().mockImplementation(({ data }: any) => ({
          ...data,
          updatedAt: new Date(),
        })),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
  });

  it('evaluates a runtime control and persists evaluation and state projection', async () => {
    const fakeEvaluator = {
      id: 'test.evaluator',
      version: '1',
      evaluate: vi.fn().mockResolvedValue({
        status: 'IMPLEMENTED' as const,
        summary: 'Control operates as expected.',
        findings: [{ code: 'TEST_CHECK', value: true }],
        evidenceRefs: [{ source: 'TestModel', description: 'Verified' }],
        validUntil: null,
      }),
    };

    complianceEvaluatorRegistry['encryption.at-rest'] = fakeEvaluator;

    const context = {
      prisma: mockPrisma,
      now: new Date('2026-09-19T14:00:00.000Z'),
      controlRegistryFingerprint: 'mock-fingerprint',
      actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
    };

    const { evaluation, controlState } = await evaluateControl({
      controlId: 'SEC-ENC-001',
      context,
      trigger: 'MANUAL',
      batchId: 'batch-1',
    });

    expect(evaluation.controlId).toBe('SEC-ENC-001');
    expect(evaluation.status).toBe('IMPLEMENTED');
    expect(evaluation.evaluatorVersion).toBe('1');
    expect(evaluation.batchId).toBe('batch-1');

    expect(controlState.controlId).toBe('SEC-ENC-001');
    expect(controlState.status).toBe('IMPLEMENTED');
    expect(controlState.latestEvaluationId).toBe(evaluation.id);
    expect(mockPrisma.complianceControlState.create).toHaveBeenCalled();
  });

  it('rejects an unknown control ID', async () => {
    const context = {
      prisma: mockPrisma,
      now: new Date(),
      controlRegistryFingerprint: 'mock-fp',
    };

    await expect(
      evaluateControl({
        controlId: 'NON-EXISTENT-999',
        context,
        trigger: 'MANUAL',
      })
    ).rejects.toThrow(/not found in registry/i);
  });

  it('rejects a catalog-only control for runtime evaluation', async () => {
    const context = {
      prisma: mockPrisma,
      now: new Date(),
      controlRegistryFingerprint: 'mock-fp',
    };

    await expect(
      evaluateControl({
        controlId: 'SEC-AUTH-001',
        context,
        trigger: 'MANUAL',
      })
    ).rejects.toThrow(/does not support runtime evaluation/i);
  });

  it('fails safely to UNVERIFIED with EVALUATOR_ERROR when evaluator throws', async () => {
    complianceEvaluatorRegistry['encryption.at-rest'] = {
      id: 'encryption.at-rest',
      version: '1',
      evaluate: vi.fn().mockRejectedValue(new Error('PostgreSQL connection timeout')),
    };

    const context = {
      prisma: mockPrisma,
      now: new Date('2026-09-19T14:00:00.000Z'),
      controlRegistryFingerprint: 'mock-fp',
    };

    const { evaluation, controlState } = await evaluateControl({
      controlId: 'SEC-ENC-001',
      context,
      trigger: 'API',
    });

    expect(evaluation.status).toBe('UNVERIFIED');
    expect(evaluation.summary).toContain('could not complete');
    expect(evaluation.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'EVALUATOR_ERROR' })])
    );
    expect(controlState.status).toBe('UNVERIFIED');
  });

  it('protects against race conditions by not overwriting newer state with an older evaluation', async () => {
    complianceEvaluatorRegistry['encryption.at-rest'] = {
      id: 'encryption.at-rest',
      version: '1',
      evaluate: vi.fn().mockResolvedValue({
        status: 'IMPLEMENTED' as const,
        summary: 'Older evaluation finished late.',
        findings: [],
        evidenceRefs: [],
      }),
    };

    // Simulate newer state existing in cache (e.g. 15:00)
    mockPrisma.complianceControlState.findUnique.mockResolvedValue({
      controlId: 'SEC-ENC-001',
      status: 'ACTION_REQUIRED',
      latestEvaluationId: 'newer-eval',
      evaluatorId: 'encryption.at-rest',
      evaluatorVersion: '1',
      evaluatedAt: new Date('2026-09-19T15:00:00.000Z'),
      summary: 'Newer evaluation result',
      updatedAt: new Date(),
    });

    // Older evaluation at 14:00 finishes late
    const context = {
      prisma: mockPrisma,
      now: new Date('2026-09-19T14:00:00.000Z'),
      controlRegistryFingerprint: 'mock-fp',
    };

    const { controlState } = await evaluateControl({
      controlId: 'SEC-ENC-001',
      context,
      trigger: 'API',
    });

    // Should retain newer state (ACTION_REQUIRED from 15:00)
    expect(controlState.latestEvaluationId).toBe('newer-eval');
    expect(controlState.status).toBe('ACTION_REQUIRED');
    expect(mockPrisma.complianceControlState.update).not.toHaveBeenCalled();
  });
});
