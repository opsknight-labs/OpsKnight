import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ComplianceEvaluationContext } from '@/lib/compliance/evaluators/types';
import { encryptionAtRestEvaluator } from '@/lib/compliance/evaluators/encryption';
import { retentionEvaluator } from '@/lib/compliance/evaluators/retention';
import {
  privacyErasureEvaluator,
  privacyExportEvaluator,
  retentionHoldEvaluator,
} from '@/lib/compliance/evaluators/privacy';
import { authorizationEvaluator } from '@/lib/compliance/evaluators/authorization';
import * as encryptionRegistry from '@/lib/encryption/registry';
import * as encryptionModule from '@/lib/encryption';
import * as authorization from '@/lib/authorization';

interface MockPrisma {
  encryptionMigrationRun: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  systemSettings: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  dataRetentionHold: {
    count: ReturnType<typeof vi.fn>;
  };
  privacyErasureExecution: {
    count: ReturnType<typeof vi.fn>;
  };
  privacyExportArtifact: {
    count: ReturnType<typeof vi.fn>;
  };
}

function makeTargetStates(
  overrides: Record<
    string,
    {
      stats?: Record<string, number>;
      status?: string;
      totalCount?: number;
      processedCount?: number;
    }
  > = {}
) {
  return encryptionRegistry.ENCRYPTION_TARGETS.map(t => {
    const o = overrides[t.id] ?? {};
    return {
      targetId: t.id,
      status: o.status ?? 'COMPLETED',
      totalCount: o.totalCount ?? 1,
      processedCount: o.processedCount ?? 1,
      inspectionStats: o.stats ?? {
        currentV3: 1,
        oldKeyV3: 0,
        legacyV2: 0,
        legacyV1: 0,
        plaintext: 0,
        unavailableKey: 0,
        ambiguous: 0,
        unreadable: 0,
      },
    };
  });
}

describe('compliance evaluators (unit)', () => {
  let mockPrisma: MockPrisma;
  const mockFingerprint = 'canonical-registry-fp-12345';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(encryptionRegistry, 'computeRegistryFingerprint').mockReturnValue(mockFingerprint);
    vi.spyOn(encryptionModule, 'getActiveKeyId').mockReturnValue('k2');

    mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn(),
      },
      systemSettings: {
        findUnique: vi.fn().mockResolvedValue({
          incidentRetentionDays: 730,
          alertRetentionDays: 365,
          logRetentionDays: 365,
          metricsRetentionDays: 365,
          completedPrivacyRequestRetentionDays: 730,
        }),
      },
      dataRetentionHold: {
        count: vi.fn().mockResolvedValue(2),
      },
      privacyErasureExecution: {
        count: vi.fn().mockResolvedValue(5),
      },
      privacyExportArtifact: {
        count: vi.fn().mockResolvedValue(3),
      },
    };
  });

  function makeContext(now = new Date()): ComplianceEvaluationContext {
    return {
      prisma: mockPrisma as unknown as PrismaClient,
      now,
      controlRegistryFingerprint: 'mock-control-fp',
    };
  }

  describe('encryption.at-rest evaluator', () => {
    it('returns ACTION_REQUIRED when no active encryption key is configured', async () => {
      vi.spyOn(encryptionModule, 'getActiveKeyId').mockReturnValue(null);

      const result = await encryptionAtRestEvaluator.evaluate(makeContext());
      expect(result.status).toBe('ACTION_REQUIRED');
      expect(result.summary).toContain('No active encryption key is configured');
      expect(result.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'NO_ACTIVE_KEY' })])
      );
    });

    it('returns UNVERIFIED when no completed VERIFY run exists', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue(null);

      const result = await encryptionAtRestEvaluator.evaluate(makeContext());
      expect(result.status).toBe('UNVERIFIED');
      expect(result.summary).toContain('No completed encryption verification exists');
      expect(result.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'VERIFICATION_MISSING' })])
      );
    });

    it('returns UNVERIFIED when latest verification has outdated registry fingerprint', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-1',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: 'stale-fingerprint-old',
        activeKeyId: 'k2',
        errorRecords: 0,
        conflictRecords: 0,
        targetStates: [],
      });

      const result = await encryptionAtRestEvaluator.evaluate(makeContext());
      expect(result.status).toBe('UNVERIFIED');
      expect(result.summary).toContain('outdated target registry fingerprint');
      expect(result.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'FINGERPRINT_MISMATCH' })])
      );
    });

    it('returns UNVERIFIED when active key changed since the latest verification run', async () => {
      vi.spyOn(encryptionModule, 'getActiveKeyId').mockReturnValue('k3');

      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-k2',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: mockFingerprint,
        activeKeyId: 'k2',
        errorRecords: 0,
        conflictRecords: 0,
        targetStates: makeTargetStates(),
      });

      const result = await encryptionAtRestEvaluator.evaluate(makeContext());
      expect(result.status).toBe('UNVERIFIED');
      expect(result.summary).toContain(
        'active encryption key changed since the latest verification'
      );
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'ACTIVE_KEY_CHANGED_SINCE_VERIFICATION' }),
        ])
      );
    });

    it('returns UNVERIFIED when latest verification is missing targets or incomplete', async () => {
      // Only 1 target state provided instead of all ENCRYPTION_TARGETS
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-incomplete',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: mockFingerprint,
        activeKeyId: 'k2',
        errorRecords: 0,
        conflictRecords: 0,
        targetStates: [
          {
            targetId: 'ApiKey.hashedKey',
            status: 'COMPLETED',
            totalCount: 5,
            processedCount: 5,
            inspectionStats: { currentV3: 5 },
          },
        ],
      });

      const result = await encryptionAtRestEvaluator.evaluate(makeContext());
      expect(result.status).toBe('UNVERIFIED');
      expect(result.summary).toContain(
        'does not cover all registered encryption targets completely'
      );
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'INCOMPLETE_VERIFICATION_COVERAGE' }),
        ])
      );
    });

    it('returns ACTION_REQUIRED when unreadable, unavailable, or conflict records exist without double-counting', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-2',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: mockFingerprint,
        activeKeyId: 'k2',
        errorRecords: 2, // Matches unavailable (1) + unreadable (1)
        conflictRecords: 1,
        targetStates: makeTargetStates({
          'oidc.client-secret': {
            stats: {
              currentV3: 10,
              oldKeyV3: 0,
              legacyV2: 0,
              legacyV1: 0,
              plaintext: 0,
              unavailableKey: 1,
              ambiguous: 0,
              unreadable: 1,
            },
          },
        }),
      });

      const result = await encryptionAtRestEvaluator.evaluate(makeContext());
      expect(result.status).toBe('ACTION_REQUIRED');
      // Total blocking issues must be 3 (2 inspection errors + 1 conflict), NOT 5 (which would be double-counting errorRecords + stats)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'BLOCKING_ISSUES', value: 3 }),
          expect.objectContaining({ code: 'UNREADABLE_RECORDS', value: 1 }),
          expect.objectContaining({ code: 'UNAVAILABLE_KEY_RECORDS', value: 1 }),
          expect.objectContaining({ code: 'CONFLICT_RECORDS', value: 1 }),
        ])
      );
      // Ensure no raw secret leakage
      expect(JSON.stringify(result)).not.toContain('password');
      expect(JSON.stringify(result)).not.toContain('vapidPrivateKey');
      expect(JSON.stringify(result)).not.toContain('raw_secret_value');
    });

    it('returns PARTIAL when older-key or legacy values remain without errors', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-3',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: mockFingerprint,
        activeKeyId: 'k2',
        errorRecords: 0,
        conflictRecords: 0,
        targetStates: makeTargetStates({
          'oidc.client-secret': {
            stats: {
              currentV3: 5,
              oldKeyV3: 2,
              legacyV2: 1,
              legacyV1: 0,
              plaintext: 0,
              unavailableKey: 0,
              ambiguous: 0,
              unreadable: 0,
            },
          },
        }),
      });

      const result = await encryptionAtRestEvaluator.evaluate(makeContext());
      expect(result.status).toBe('PARTIAL');
      expect(result.summary).toContain('record(s) remain on older keys');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'LEGACY_RECORDS', value: 3 }),
          expect.objectContaining({ code: 'OLD_KEY_V3_RECORDS', value: 2 }),
          expect.objectContaining({ code: 'LEGACY_V2_RECORDS', value: 1 }),
        ])
      );
    });

    it('returns IMPLEMENTED when all verified records across all targets are authenticated on active v3 key', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-4',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: mockFingerprint,
        activeKeyId: 'k2',
        errorRecords: 0,
        conflictRecords: 0,
        targetStates: makeTargetStates(),
      });

      const result = await encryptionAtRestEvaluator.evaluate(makeContext());
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'AUTHENTICATED_CURRENT_V3',
            value: encryptionRegistry.ENCRYPTION_TARGETS.length,
          }),
          expect.objectContaining({ code: 'LEGACY_RECORDS', value: 0 }),
          expect.objectContaining({ code: 'UNREADABLE_RECORDS', value: 0 }),
        ])
      );
    });
  });

  describe('data.retention evaluator', () => {
    it('returns IMPLEMENTED when retention policy is active and hold engine is available', async () => {
      const result = await retentionEvaluator.evaluate(makeContext());
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.summary).toContain('Retention policies are configured');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'HOLD_AWARE_CLEANUP_AVAILABLE', value: true }),
          expect.objectContaining({ code: 'ACTIVE_RETENTION_HOLDS', value: 2 }),
        ])
      );
      expect(mockPrisma.systemSettings.findUnique).toHaveBeenCalledWith({
        where: { id: 'default' },
        select: expect.any(Object),
      });
    });

    it('returns ACTION_REQUIRED when systemSettings row is not present in database', async () => {
      mockPrisma.systemSettings.findUnique.mockResolvedValueOnce(null);

      const result = await retentionEvaluator.evaluate(makeContext());
      expect(result.status).toBe('ACTION_REQUIRED');
      expect(result.summary).toContain('not been configured in this deployment');
      expect(result.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'RETENTION_SETTINGS_MISSING' })])
      );
    });
  });

  describe('privacy evaluators', () => {
    it('evaluates privacy holds correctly', async () => {
      const result = await retentionHoldEvaluator.evaluate(makeContext());
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'ACTIVE_HOLD_COUNT', value: 2 }),
          expect.objectContaining({ code: 'CLEANUP_FENCING_AVAILABLE', value: true }),
        ])
      );
    });

    it('evaluates privacy erasure correctly', async () => {
      const result = await privacyErasureEvaluator.evaluate(makeContext());
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'SUBJECT_DISCOVERY_AVAILABLE', value: true }),
          expect.objectContaining({ code: 'ERASURE_EXECUTION_ENGINE_AVAILABLE', value: true }),
        ])
      );
    });

    it('evaluates privacy export correctly', async () => {
      const result = await privacyExportEvaluator.evaluate(makeContext());
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'SUBJECT_DISCOVERY_AVAILABLE', value: true }),
          expect.objectContaining({ code: 'ENCRYPTED_EXPORT_ARTIFACTS_AVAILABLE', value: true }),
          expect.objectContaining({ code: 'HISTORICAL_ARTIFACTS_COUNT', value: 3 }),
        ])
      );
    });
  });

  describe('authorization.rbac evaluator', () => {
    it('returns IMPLEMENTED when capability and role mappings are complete', async () => {
      const result = await authorizationEvaluator.evaluate(makeContext());
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'REGISTERED_ROLES_COUNT', value: 4 }),
          expect.objectContaining({ code: 'ADMIN_GOVERNANCE_VERIFIED', value: true }),
        ])
      );
    });

    it('returns ACTION_REQUIRED if admin role is missing required management capabilities', async () => {
      vi.spyOn(authorization, 'getRoleCapabilities').mockImplementation(
        (role: authorization.AppRole) => {
          if (role === 'ADMIN') return [];
          return ['incident.read.all'] as unknown as readonly authorization.Capability[];
        }
      );

      const result = await authorizationEvaluator.evaluate(makeContext());
      expect(result.status).toBe('ACTION_REQUIRED');
      expect(result.summary).toContain('does not have any assigned capabilities');
    });
  });
});
