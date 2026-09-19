import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { startEncryptionRun } from '@/lib/encryption/worker';
import { emitAuditEvent } from '@/lib/audit';

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  mode: z.enum(['PREVIEW', 'MIGRATE', 'VERIFY']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const startRunSchema = z.object({
  mode: z.enum(['PREVIEW', 'MIGRATE', 'VERIFY']),
});

export async function GET(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.ENCRYPTION_READ);

    const parsed = listQuerySchema.safeParse({
      status: request.nextUrl.searchParams.get('status') ?? undefined,
      mode: request.nextUrl.searchParams.get('mode') ?? undefined,
      cursor: request.nextUrl.searchParams.get('cursor') ?? undefined,
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
    });

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

    const { status, mode, cursor, limit } = parsed.data;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (mode) where.mode = mode;
    if (cursor) where.id = { lt: cursor };

    const runs = await prisma.encryptionMigrationRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        initiatedBy: {
          select: { id: true, name: true, email: true },
        },
        targetStates: {
          orderBy: { targetId: 'asc' },
        },
      },
    });

    const hasMore = runs.length > limit;
    const items = hasMore ? runs.slice(0, limit) : runs;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return jsonOk({ runs: items, nextCursor }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await assertCapability(CAPABILITIES.ENCRYPTION_MANAGE);

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = startRunSchema.safeParse(body);
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

    const run = await startEncryptionRun(prisma, {
      mode: parsed.data.mode,
      initiatedById: user.id,
      runSynchronously: false,
    });

    await emitAuditEvent({
      action: 'ENCRYPTION_MIGRATION_STARTED',
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
        registryFingerprint: run.registryFingerprint,
      },
    });

    return jsonOk({ run }, 201);
  } catch (error: unknown) {
    if (isAppError(error)) return jsonError(error);
    const message = error instanceof Error ? error.message : 'Failed to start encryption run';
    return jsonError(
      new AppError({
        code: 'INTERNAL_ERROR',
        userMessage: message,
        cause: error,
      })
    );
  }
}
