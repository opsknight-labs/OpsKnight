/**
 * Verification service for database encryption integrity and key retirement eligibility.
 */

import { PrismaClient } from '@prisma/client';
import { executeMigrationRun } from './migration';
import { computeRegistryFingerprint, ENCRYPTION_TARGETS } from './registry';
import { getEncryptionKeyringEntries } from '../encryption';
import { evaluateKeyRetirementReadiness } from './retirement';

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

  // Post-process to calculate which inactive keys are ready for database retirement.
  // Uses the authoritative evaluateKeyRetirementReadiness calculator to guarantee
  // that safeForDatabaseKeyRetirement matches the retirement panel and fails closed on errors.
  const run = await prisma.encryptionMigrationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { targetStates: true },
  });

  if (run.status === 'COMPLETED') {
    const retirementReport = await evaluateKeyRetirementReadiness(prisma);
    const retiredKeys = retirementReport.assessments
      .filter(a => a.status === 'DATABASE_READY_FOR_RETIREMENT')
      .map(a => a.keyId);

    await prisma.encryptionMigrationRun.update({
      where: { id: runId },
      data: {
        safeForDatabaseKeyRetirement: retiredKeys,
      },
    });
  }

  return runId;
}
