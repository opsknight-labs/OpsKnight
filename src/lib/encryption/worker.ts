/**
 * Encryption lifecycle worker and run orchestrator.
 */

import { PrismaClient, EncryptionMigrationRun } from '@prisma/client';
import { MigrationMode } from './types';
import { executeMigrationRun } from './migration';
import { scheduleJob } from '@/lib/jobs/queue';
import { getEncryptionKeyringEntries } from '@/lib/encryption';
import { ENCRYPTION_TARGETS, computeRegistryFingerprint } from './registry';
import { logger } from '@/lib/logger';

export interface StartRunOptions {
  mode: MigrationMode;
  initiatedById?: string | null;
  runSynchronously?: boolean;
}

export async function startEncryptionRun(
  prisma: PrismaClient,
  options: StartRunOptions
): Promise<EncryptionMigrationRun> {
  const { mode, initiatedById, runSynchronously = false } = options;

  // 1. Check for any active RUNNING run
  const activeRun = await prisma.encryptionMigrationRun.findFirst({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
    },
  });

  if (activeRun) {
    throw new Error(
      `An encryption migration run (${activeRun.id}, mode: ${activeRun.mode}) is currently in progress. Only one run can execute at a time.`
    );
  }

  const keyring = getEncryptionKeyringEntries();
  const activeKey = keyring[0];

  if (mode === 'MIGRATE' && !activeKey) {
    throw new Error('Cannot start migration: no active encryption key configured in keyring');
  }

  const fingerprint = computeRegistryFingerprint(ENCRYPTION_TARGETS);

  const run = await prisma.encryptionMigrationRun.create({
    data: {
      mode,
      status: 'PENDING',
      registryFingerprint: fingerprint,
      activeKeyId: activeKey?.id ?? null,
      initiatedById: initiatedById ?? null,
    },
  });

  if (runSynchronously) {
    // Execute directly in-process
    await executeMigrationRun({ runId: run.id, prisma });
    return await prisma.encryptionMigrationRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { targetStates: true },
    });
  }

  // Schedule durable background job
  try {
    await scheduleJob('ENCRYPTION_LIFECYCLE', new Date(), { runId: run.id });
  } catch (scheduleError) {
    logger.error(
      '[Encryption Lifecycle] Failed to enqueue background job, falling back to async execution',
      { scheduleError }
    );
    // In environments where background queue worker is disabled, trigger asynchronously
    setTimeout(() => {
      executeMigrationRun({ runId: run.id, prisma }).catch(err => {
        logger.error('[Encryption Lifecycle] Async execution failed', { err });
      });
    }, 10);
  }

  return run;
}

export async function cancelEncryptionRun(
  prisma: PrismaClient,
  runId: string
): Promise<EncryptionMigrationRun> {
  const run = await prisma.encryptionMigrationRun.findUnique({
    where: { id: runId },
  });

  if (!run) {
    throw new Error(`Encryption migration run not found: ${runId}`);
  }

  if (run.status === 'COMPLETED' || run.status === 'FAILED') {
    throw new Error(`Cannot cancel run ${runId} with status ${run.status}`);
  }

  return await prisma.encryptionMigrationRun.update({
    where: { id: runId },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
    },
  });
}
