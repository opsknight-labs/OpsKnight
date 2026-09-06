import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import prisma from '@/lib/prisma';

async function requireAdmin() {
  const session = await getServerSession(await getAuthOptions());
  return session?.user?.role === 'ADMIN';
}

export async function GET() {
  if (!(await requireAdmin())) return jsonError('Forbidden', 403);
  const [external, chatOps, jobs] = await Promise.all([
    prisma.externalOperation.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        provider: true,
        operation: true,
        incidentId: true,
        externalKey: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
      },
    }),
    prisma.chatOpsIntent.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        kind: true,
        workspaceId: true,
        channelId: true,
        attempt: true,
        lastError: true,
        updatedAt: true,
      },
    }),
    prisma.backgroundJob.findMany({
      where: { status: 'FAILED', type: { in: ['CHATOPS_INTENT', 'EXTERNAL_OPERATION'] } },
      orderBy: { failedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        type: true,
        attempts: true,
        maxAttempts: true,
        error: true,
        failedAt: true,
      },
    }),
  ]);
  return jsonOk({ external, chatOps, jobs });
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return jsonError('Forbidden', 403);
  const body = (await request.json().catch(() => null)) as { kind?: string; id?: string } | null;
  if (!body?.id || !['external', 'chatops'].includes(body.kind ?? ''))
    return jsonError('Invalid retry request', 400);
  await prisma.$transaction(async tx => {
    if (body.kind === 'external') {
      const operation = await tx.externalOperation.update({
        where: { id: body.id },
        data: {
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await tx.backgroundJob.create({
        data: {
          type: 'EXTERNAL_OPERATION',
          status: 'PENDING',
          scheduledAt: new Date(),
          maxAttempts: 8,
          payload: { operationId: operation.id },
        },
      });
    } else {
      const intent = await tx.chatOpsIntent.update({
        where: { id: body.id },
        data: {
          status: 'PENDING',
          attempt: 0,
          lastError: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await tx.backgroundJob.create({
        data: {
          type: 'CHATOPS_INTENT',
          status: 'PENDING',
          scheduledAt: new Date(),
          maxAttempts: 8,
          payload: { intentId: intent.id },
        },
      });
    }
  });
  return jsonOk({ retried: true });
}
