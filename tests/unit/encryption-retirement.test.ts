import { describe, it, expect, vi } from 'vitest';
import { evaluateKeyRetirementReadiness } from '@/lib/encryption/retirement';
import * as encryptionModule from '@/lib/encryption';
import * as registryModule from '@/lib/encryption/registry';

type DbClient = Parameters<typeof evaluateKeyRetirementReadiness>[0];

describe('Encryption Retirement Calculator Unit Tests', () => {
  it('identifies active key as ACTIVE_KEY and non-retirable', async () => {
    vi.spyOn(encryptionModule, 'getEncryptionKeyringMetadata').mockResolvedValueOnce({
      activeKeyId: 'k2',
      keys: [
        { id: 'k2', source: 'env', isActive: true },
        { id: 'k1', source: 'env', isActive: false },
      ],
      totalKeys: 2,
      hasLegacyDbKey: false,
    });

    const mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as DbClient;

    const report = await evaluateKeyRetirementReadiness(mockPrisma);

    expect(report.activeKeyId).toBe('k2');
    const activeAssessment = report.assessments.find(a => a.keyId === 'k2');
    expect(activeAssessment?.status).toBe('ACTIVE_KEY');

    const inactiveAssessment = report.assessments.find(a => a.keyId === 'k1');
    expect(inactiveAssessment?.status).toBe('UNVERIFIED');
  });

  it('marks inactive key as DATABASE_READY_FOR_RETIREMENT when 0 references detected in verified run', async () => {
    const fingerprint = registryModule.computeRegistryFingerprint();

    vi.spyOn(encryptionModule, 'getEncryptionKeyringMetadata').mockResolvedValueOnce({
      activeKeyId: 'k2',
      keys: [
        { id: 'k2', source: 'env', isActive: true },
        { id: 'k1', source: 'env', isActive: false },
      ],
      totalKeys: 2,
      hasLegacyDbKey: false,
    });

    const targetStates = registryModule.ENCRYPTION_TARGETS.map((t, idx) => ({
      id: `ts-${idx}`,
      targetId: t.id,
      status: 'COMPLETED',
      keysDetected: { k2: 5 }, // No k1 references
    }));

    const mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-verify-1',
          mode: 'VERIFY',
          status: 'COMPLETED',
          registryFingerprint: fingerprint,
          errorRecords: 0,
          conflictRecords: 0,
          completedAt: new Date(),
          targetStates,
        }),
      },
    } as unknown as DbClient;

    const report = await evaluateKeyRetirementReadiness(mockPrisma);

    const k1Assessment = report.assessments.find(a => a.keyId === 'k1');
    expect(k1Assessment?.status).toBe('DATABASE_READY_FOR_RETIREMENT');
    expect(k1Assessment?.remainingReferences).toBe(0);
    expect(report.allEligibleRetiredFromDatabase).toBe(true);
  });

  it('marks inactive key as ACTIVE_REFERENCES_EXIST when references remain in verified run', async () => {
    const fingerprint = registryModule.computeRegistryFingerprint();

    vi.spyOn(encryptionModule, 'getEncryptionKeyringMetadata').mockResolvedValueOnce({
      activeKeyId: 'k2',
      keys: [
        { id: 'k2', source: 'env', isActive: true },
        { id: 'k1', source: 'env', isActive: false },
      ],
      totalKeys: 2,
      hasLegacyDbKey: false,
    });

    const targetStates = registryModule.ENCRYPTION_TARGETS.map((t, idx) => ({
      id: `ts-${idx}`,
      targetId: t.id,
      status: 'COMPLETED',
      keysDetected: t.id === 'oidc.client-secret' ? { k1: 3, k2: 2 } : { k2: 5 },
    }));

    const mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-verify-1',
          mode: 'VERIFY',
          status: 'COMPLETED',
          registryFingerprint: fingerprint,
          errorRecords: 0,
          conflictRecords: 0,
          completedAt: new Date(),
          targetStates,
        }),
      },
    } as unknown as DbClient;

    const report = await evaluateKeyRetirementReadiness(mockPrisma);

    const k1Assessment = report.assessments.find(a => a.keyId === 'k1');
    expect(k1Assessment?.status).toBe('ACTIVE_REFERENCES_EXIST');
    expect(k1Assessment?.remainingReferences).toBe(3);
    expect(k1Assessment?.targetsWithReferences).toContain('oidc.client-secret');
    expect(report.allEligibleRetiredFromDatabase).toBe(false);
  });

  it('fails closed with UNRESOLVED_RECORDS_EXIST when errors exist in verified run', async () => {
    const fingerprint = registryModule.computeRegistryFingerprint();

    vi.spyOn(encryptionModule, 'getEncryptionKeyringMetadata').mockResolvedValueOnce({
      activeKeyId: 'k2',
      keys: [
        { id: 'k2', source: 'env', isActive: true },
        { id: 'k1', source: 'env', isActive: false },
      ],
      totalKeys: 2,
      hasLegacyDbKey: false,
    });

    const targetStates = registryModule.ENCRYPTION_TARGETS.map((t, idx) => ({
      id: `ts-${idx}`,
      targetId: t.id,
      status: 'COMPLETED',
      keysDetected: { k2: 5 },
    }));

    const mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-verify-1',
          mode: 'VERIFY',
          status: 'COMPLETED',
          registryFingerprint: fingerprint,
          errorRecords: 2, // 2 unreadable records!
          conflictRecords: 0,
          completedAt: new Date(),
          targetStates,
        }),
      },
    } as unknown as DbClient;

    const report = await evaluateKeyRetirementReadiness(mockPrisma);

    const k1Assessment = report.assessments.find(a => a.keyId === 'k1');
    expect(k1Assessment?.status).toBe('UNRESOLVED_RECORDS_EXIST');
    expect(report.allEligibleRetiredFromDatabase).toBe(false);
  });

  it('evaluates database_legacy fallback key readiness', async () => {
    const fingerprint = registryModule.computeRegistryFingerprint();

    vi.spyOn(encryptionModule, 'getEncryptionKeyringMetadata').mockResolvedValueOnce({
      activeKeyId: 'k2',
      keys: [
        { id: 'k2', source: 'env', isActive: true },
        { id: 'database_legacy', source: 'database_legacy', isActive: false },
      ],
      totalKeys: 2,
      hasLegacyDbKey: true,
    });

    const targetStates = registryModule.ENCRYPTION_TARGETS.map((t, idx) => ({
      id: `ts-${idx}`,
      targetId: t.id,
      status: 'COMPLETED',
      keysDetected: { k2: 5 }, // 0 database_legacy references
    }));

    const mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-verify-1',
          mode: 'VERIFY',
          status: 'COMPLETED',
          registryFingerprint: fingerprint,
          errorRecords: 0,
          conflictRecords: 0,
          completedAt: new Date(),
          targetStates,
        }),
      },
    } as unknown as DbClient;

    const report = await evaluateKeyRetirementReadiness(mockPrisma);

    const dbKeyAssessment = report.assessments.find(a => a.keyId === 'database_legacy');
    expect(dbKeyAssessment?.status).toBe('DATABASE_READY_FOR_RETIREMENT');
    expect(dbKeyAssessment?.message).toContain('legacy database encryption key');
    expect(report.allEligibleRetiredFromDatabase).toBe(true);
  });
});
