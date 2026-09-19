import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { evaluateKeyRetirementReadiness } from '@/lib/encryption/retirement';

export async function GET(_request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.ENCRYPTION_READ);

    const report = await evaluateKeyRetirementReadiness(prisma);

    return jsonOk({ report }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
