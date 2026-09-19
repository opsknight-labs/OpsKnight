// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { encryptionAtRestEvaluator } from '@/lib/compliance/evaluators/encryption';
import { retentionEvaluator } from '@/lib/compliance/evaluators/retention';
import {
  retentionHoldEvaluator,
  privacyErasureEvaluator,
  privacyExportEvaluator,
} from '@/lib/compliance/evaluators/privacy';
import { authorizationEvaluator } from '@/lib/compliance/evaluators/authorization';
import * as encryptionRegistry from '@/lib/encryption/registry';
import * as authorization from '@/lib/authorization';

describe('compliance evaluators (unit)', () => {
  let mockPrisma: any;
  const mockFingerprint = 'canonical-registry-fp-12345';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(encryptionRegistry, 'computeRegistryFingerprint').mockReturnValue(mockFingerprint);

    mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn(),
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

  describe('encryption.at-rest evaluator', () => {
    it('returns UNVERIFIED when no completed VERIFY run exists', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue(null);

      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await encryptionAtRestEvaluator.evaluate(context);
      expect(result.status).toBe('UNVERIFIED');
      expect(result.summary).toContain('No completed encryption verification');
      expect(result.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'VERIFICATION_MISSING' })])
      );
    });

    it('returns UNVERIFIED when latest verification has outdated registry fingerprint', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-1',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: 'stale-old-fingerprint',
        targetStates: [],
        errorRecords: 0,
        conflictRecords: 0,
      });

      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await encryptionAtRestEvaluator.evaluate(context);
      expect(result.status).toBe('UNVERIFIED');
      expect(result.summary).toContain('outdated target registry fingerprint');
      expect(result.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'FINGERPRINT_MISMATCH' })])
      );
    });

    it('returns ACTION_REQUIRED when unreadable, unavailable, or conflict records exist', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-2',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: mockFingerprint,
        errorRecords: 1,
        conflictRecords: 1,
        targetStates: [
          {
            targetId: 'User.totpSecret',
            inspectionStats: {
              unreadable: 1,
              unavailableKey: 1,
              ambiguous: 0,
              currentV3: 10,
            },
          },
        ],
      });

      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await encryptionAtRestEvaluator.evaluate(context);
      expect(result.status).toBe('ACTION_REQUIRED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'BLOCKING_ISSUES' }),
          expect.objectContaining({ code: 'UNREADABLE_RECORDS', value: 1 }),
          expect.objectContaining({ code: 'UNAVAILABLE_KEY_RECORDS', value: 1 }),
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
        errorRecords: 0,
        conflictRecords: 0,
        targetStates: [
          {
            targetId: 'ApiKey.hashedKey',
            inspectionStats: {
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
        ],
      });

      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await encryptionAtRestEvaluator.evaluate(context);
      expect(result.status).toBe('PARTIAL');
      expect(result.summary).toContain('3 record(s) remain on older keys');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'LEGACY_RECORDS', value: 3 }),
          expect.objectContaining({ code: 'OLD_KEY_V3_RECORDS', value: 2 }),
          expect.objectContaining({ code: 'LEGACY_V2_RECORDS', value: 1 }),
        ])
      );
    });

    it('returns IMPLEMENTED when all verified records are authenticated on active v3 key', async () => {
      mockPrisma.encryptionMigrationRun.findFirst.mockResolvedValue({
        id: 'run-4',
        mode: 'VERIFY',
        status: 'COMPLETED',
        registryFingerprint: mockFingerprint,
        errorRecords: 0,
        conflictRecords: 0,
        targetStates: [
          {
            targetId: 'ApiKey.hashedKey',
            inspectionStats: {
              currentV3: 15,
              oldKeyV3: 0,
              legacyV2: 0,
              legacyV1: 0,
              plaintext: 0,
              unavailableKey: 0,
              ambiguous: 0,
              unreadable: 0,
            },
          },
        ],
      });

      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await encryptionAtRestEvaluator.evaluate(context);
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'AUTHENTICATED_CURRENT_V3', value: 15 }),
          expect.objectContaining({ code: 'LEGACY_RECORDS', value: 0 }),
          expect.objectContaining({ code: 'UNREADABLE_RECORDS', value: 0 }),
        ])
      );
    });
  });

  describe('data.retention evaluator', () => {
    it('returns IMPLEMENTED when retention policy is active and hold engine is available', async () => {
      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await retentionEvaluator.evaluate(context);
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.summary).toContain('Retention policies are configured');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'HOLD_AWARE_CLEANUP_AVAILABLE', value: true }),
          expect.objectContaining({ code: 'ACTIVE_RETENTION_HOLDS', value: 2 }),
        ])
      );
    });
  });

  describe('privacy evaluators', () => {
    it('evaluates privacy holds correctly', async () => {
      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await retentionHoldEvaluator.evaluate(context);
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'ACTIVE_HOLD_COUNT', value: 2 }),
          expect.objectContaining({ code: 'CLEANUP_FENCING_AVAILABLE', value: true }),
        ])
      );
    });

    it('evaluates privacy erasure correctly', async () => {
      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await privacyErasureEvaluator.evaluate(context);
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'SUBJECT_DISCOVERY_AVAILABLE', value: true }),
          expect.objectContaining({ code: 'ERASURE_EXECUTION_ENGINE_AVAILABLE', value: true }),
        ])
      );
    });

    it('evaluates privacy export correctly', async () => {
      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await privacyExportEvaluator.evaluate(context);
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'SUBJECT_DISCOVERY_AVAILABLE', value: true }),
          expect.objectContaining({ code: 'ENCRYPTED_EXPORT_ARTIFACTS_AVAILABLE', value: true }),
        ])
      );
    });
  });

  describe('authorization.rbac evaluator', () => {
    it('returns IMPLEMENTED when capability and role mappings are complete', async () => {
      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await authorizationEvaluator.evaluate(context);
      expect(result.status).toBe('IMPLEMENTED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'ADMIN_GOVERNANCE_VERIFIED', value: true }),
        ])
      );
    });

    it('returns ACTION_REQUIRED if admin role is missing required management capabilities', async () => {
      vi.spyOn(authorization, 'getRoleCapabilities').mockImplementation((role: string) => {
        if (role === 'ADMIN') return [];
        return ['incident.read.all'] as any;
      });

      const context = {
        prisma: mockPrisma,
        now: new Date(),
        controlRegistryFingerprint: 'mock-control-fp',
      };

      const result = await authorizationEvaluator.evaluate(context);
      expect(result.status).toBe('ACTION_REQUIRED');
      expect(result.summary).toContain('does not have any assigned capabilities');
    });
  });
});
