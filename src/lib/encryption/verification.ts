/**
 * Verification service for database encryption integrity and key retirement eligibility.
 */

import { PrismaClient } from '@prisma/client';
import { executeMigrationRun } from './migration';
import { computeRegistryFingerprint, ENCRYPTION_TARGETS } from './registry';
import { getEncryptionKeyringEntries } from '../encryption';

export async function createVerificationRun(
  prisma: PrismaClient,
  initiatedById?: string
): Promise<string> {
  const keyring = getEncryptionKeyringEntries();
  const activeKey = keyring[0];
  const fingerprint = computeRegistryFingerprint(ENCRYPTION_TARGETS);

  const run = await prisma.encryptionMigrationRun.create({
    data: {
      mode: 'VERIFY',
      status: 'PENDING',
      registryFingerprint: fingerprint,
      activeKeyId: activeKey?.id ?? null,
      initiatedById: initiatedById ?? null,
    },
  });

  return run.id;
}

export async function runFullVerification(
  prisma: PrismaClient,
  initiatedById?: string
): Promise<string> {
  const runId = await createVerificationRun(prisma, initiatedById);
  await executeMigrationRun({ runId, prisma });

  // Post-process to calculate which inactive keys have exactly 0 database occurrences
  const run = await prisma.encryptionMigrationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { targetStates: true },
  });

  if (run.status === 'COMPLETED') {
    const keyring = getEncryptionKeyringEntries();
    const activeKeyId = keyring[0]?.id;

    // Aggregate detected key occurrences across all target states
    const keyCounts = new Map<string, number>();
    for (const state of run.targetStates) {
      if (state.keysDetected && typeof state.keysDetected === 'object') {
        for (const [keyId, count] of Object.entries(state.keysDetected as Record<string, number>)) {
          keyCounts.set(keyId, (keyCounts.get(keyId) ?? 0) + count);
        }
      }
    }

    // Inactive keys with 0 detected occurrences
    const retiredKeys: string[] = [];
    for (const entry of keyring) {
      const count = keyCounts.get(entry.id) ?? 0;
      if (entry.id !== activeKeyId && count === 0) {
        retiredKeys.push(entry.id);
      }
    }

    await prisma.encryptionMigrationRun.update({
      where: { id: runId },
      data: {
        safeForDatabaseKeyRetirement: retiredKeys,
      },
    });
  }

  return runId;
}
