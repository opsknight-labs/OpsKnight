/**
 * Calculator for database-side key retirement readiness.
 * Determines if a non-active key is completely absent from the database
 * based strictly on fresh verification runs matching the current registry fingerprint.
 */

import { PrismaClient } from '@prisma/client';
import { getEncryptionKeyringMetadata } from '../encryption';
import { ENCRYPTION_TARGETS, computeRegistryFingerprint } from './registry';
import { KeyRetirementAssessment, KeyRetirementReport } from './types';

export async function evaluateKeyRetirementReadiness(
  prisma: PrismaClient
): Promise<KeyRetirementReport> {
  const metadata = await getEncryptionKeyringMetadata();
  const currentFingerprint = computeRegistryFingerprint(ENCRYPTION_TARGETS);

  // Find the latest completed VERIFY run
  const latestVerifyRun = await prisma.encryptionMigrationRun.findFirst({
    where: {
      mode: 'VERIFY',
      status: 'COMPLETED',
      registryFingerprint: currentFingerprint,
    },
    orderBy: { completedAt: 'desc' },
    include: {
      targetStates: true,
    },
  });

  const assessments: KeyRetirementAssessment[] = [];

  for (const key of metadata.keys) {
    if (key.isActive) {
      assessments.push({
        keyId: key.id,
        status: 'ACTIVE_KEY',
        remainingReferences: 0,
        targetsWithReferences: [],
        message: `Key "${key.id}" is currently the active encryption key.`,
        guidance:
          'Active keys cannot be retired. To rotate this key, configure a new primary key in ENCRYPTION_KEYS and deploy.',
      });
      continue;
    }

    // Inactive key
    if (!latestVerifyRun) {
      assessments.push({
        keyId: key.id,
        status: 'UNVERIFIED',
        remainingReferences: -1,
        targetsWithReferences: [],
        message: `Key "${key.id}" status is unverified.`,
        guidance:
          'No completed verification run matches the current schema registry. Trigger a fresh Encryption Verification scan to verify retirement readiness.',
      });
      continue;
    }

    // Analyze targetStates from verified run
    let totalReferences = 0;
    const targetsWithRefs: string[] = [];

    for (const state of latestVerifyRun.targetStates) {
      if (state.keysDetected && typeof state.keysDetected === 'object') {
        const count = (state.keysDetected as Record<string, number>)[key.id] || 0;
        if (count > 0) {
          totalReferences += count;
          targetsWithRefs.push(state.targetId);
        }
      }
    }

    if (totalReferences === 0) {
      assessments.push({
        keyId: key.id,
        status: 'DATABASE_READY_FOR_RETIREMENT',
        remainingReferences: 0,
        targetsWithReferences: [],
        message: `Database has 0 remaining secrets encrypted with key "${key.id}".`,
        guidance: `Database ready for operator-controlled retirement. You may safely remove "${key.id}" from ENCRYPTION_KEYS after verifying your backup and replica retention policies.`,
      });
    } else {
      assessments.push({
        keyId: key.id,
        status: 'ACTIVE_REFERENCES_EXIST',
        remainingReferences: totalReferences,
        targetsWithReferences: targetsWithRefs,
        message: `Database still contains ${totalReferences} secret(s) encrypted with key "${key.id}" across ${targetsWithRefs.length} target(s).`,
        guidance: `Run an Encryption Migration to re-encrypt remaining secrets to the active key ("${metadata.activeKeyId ?? 'active'}") before removing this key from your environment.`,
      });
    }
  }

  const allEligibleRetired = assessments
    .filter(a => a.status !== 'ACTIVE_KEY')
    .every(a => a.status === 'DATABASE_READY_FOR_RETIREMENT');

  return {
    evaluatedAt: new Date().toISOString(),
    registryFingerprint: currentFingerprint,
    verifiedRunId: latestVerifyRun?.id ?? null,
    verifiedRunCompletedAt: latestVerifyRun?.completedAt?.toISOString() ?? null,
    activeKeyId: metadata.activeKeyId,
    assessments,
    allEligibleRetiredFromDatabase: metadata.keys.length > 1 && allEligibleRetired,
  };
}
