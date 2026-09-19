import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { cancelEncryptionRun } from '@/lib/encryption/worker';
import { emitAuditEvent } from '@/lib/audit';

const actionSchema = z.object({
  action: z.enum(['cancel']),
});

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.ENCRYPTION_READ);
    const { id } = await context.params;

    const run = await prisma.encryptionMigrationRun.findUnique({
      where: { id },
      include: {
        targetStates: {
          orderBy: { targetId: 'asc' },
        },
        issues: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        initiatedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!run) {
      return jsonError(
        new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: `Encryption run ${id} not found` }),
        404
      );
    }

    return jsonOk({ run }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await assertCapability(CAPABILITIES.ENCRYPTION_MANAGE);
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          fields: parsed.error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        })
      );
    }

    const run = await cancelEncryptionRun(prisma, id);

    await emitAuditEvent({
      action: 'ENCRYPTION_RUN_CANCELLED',
      source: 'API',
      target: {
        type: 'ENCRYPTION_MIGRATION',
        id: run.id,
      },
      actor: {
        type: 'USER',
        id: user.id,
        email: user.email,
        name: user.name,
      },
      metadata: {
        runId: run.id,
        mode: run.mode,
      },
    });

    return jsonOk({ run }, 200);
  } catch (error: unknown) {
    if (isAppError(error)) return jsonError(error);
    const message = error instanceof Error ? error.message : 'Failed to perform run action';
    return jsonError(
      new AppError({
        code: 'INTERNAL_ERROR',
        userMessage: message,
        cause: error,
      })
    );
  }
}
