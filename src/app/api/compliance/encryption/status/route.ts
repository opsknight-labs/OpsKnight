import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { getEncryptionKeyringMetadata } from '@/lib/encryption';
import { computeRegistryFingerprint, ENCRYPTION_TARGETS } from '@/lib/encryption/registry';

export async function GET(_request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.ENCRYPTION_READ);

    const keyring = await getEncryptionKeyringMetadata();
    const registryFingerprint = computeRegistryFingerprint(ENCRYPTION_TARGETS);

    const activeRun = await prisma.encryptionMigrationRun.findFirst({
      where: {
        status: { in: ['PENDING', 'RUNNING'] },
      },
      include: {
        targetStates: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestCompletedRuns = await prisma.encryptionMigrationRun.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: 5,
    });

    return jsonOk(
      {
        keyring,
        registryFingerprint,
        targetsCount: ENCRYPTION_TARGETS.length,
        activeRun,
        latestCompletedRuns,
      },
      200,
      { 'Cache-Control': 'private, no-store' }
    );
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
