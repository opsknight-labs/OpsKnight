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

    const mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-verify-1',
          mode: 'VERIFY',
          status: 'COMPLETED',
          registryFingerprint: fingerprint,
          completedAt: new Date(),
          targetStates: [
            {
              id: 'ts-1',
              targetId: 'oidc.client-secret',
              keysDetected: { k2: 5 }, // No k1
            },
            {
              id: 'ts-2',
              targetId: 'slack.bot-token',
              keysDetected: { k2: 2 }, // No k1
            },
          ],
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

    const mockPrisma = {
      encryptionMigrationRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-verify-1',
          mode: 'VERIFY',
          status: 'COMPLETED',
          registryFingerprint: fingerprint,
          completedAt: new Date(),
          targetStates: [
            {
              id: 'ts-1',
              targetId: 'oidc.client-secret',
              keysDetected: { k1: 3, k2: 2 },
            },
          ],
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
});
