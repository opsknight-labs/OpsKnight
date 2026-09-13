import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';

async function requireAdmin() {
  const session = await getServerSession(await getAuthOptions());
  return session?.user?.role === 'ADMIN' ? session : null;
}

export async function GET() {
  if (!(await requireAdmin())) return jsonError('Forbidden', 403);
  const [external, chatOps, jobs] = await Promise.all([
    prisma.externalOperation.findMany({
      where: { status: { in: ['FAILED', 'AMBIGUOUS'] } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        provider: true,
        operation: true,
        incidentId: true,
        externalKey: true,
        attempts: true,
        status: true,
        resultPayload: true,
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
  const admin = await requireAdmin();
  if (!admin) return jsonError('Forbidden', 403);
  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    id?: string;
    resolution?: 'retry' | 'mark_failed' | 'mark_delivered';
    providerMessageId?: string;
    conversationId?: string;
  } | null;
  if (!body?.id || !['external', 'chatops'].includes(body.kind ?? ''))
    return jsonError('Invalid retry request', 400);
  await prisma.$transaction(async tx => {
    if (body.kind === 'external') {
      const existing = await tx.externalOperation.findUnique({ where: { id: body.id } });
      if (!existing) throw new Error('External operation not found');
      if (existing.status === 'AMBIGUOUS') {
        if (body.resolution === 'mark_delivered') {
          const payload = existing.requestPayload as Record<string, unknown> | null;
          const destinationId = typeof payload?.destinationId === 'string' ? payload.destinationId : '';
          if ((existing.provider as string) !== 'MICROSOFT_TEAMS' || !existing.incidentId || !destinationId || !body.providerMessageId?.trim() || !body.conversationId?.trim()) {
            throw new Error('Ambiguous Teams delivery requires providerMessageId and conversationId');
          }
          const destination = await tx.microsoftTeamsDestination.findUnique({ where: { id: destinationId } });
          if (!destination) throw new Error('Teams destination no longer exists');
          const snapshot = payload?.destinationSnapshot as Record<string, unknown> | undefined;
          if (snapshot && (snapshot.tenantId !== destination.tenantId || snapshot.teamId !== destination.teamId || snapshot.channelId !== destination.channelId)) {
            throw new Error('Teams destination changed after this delivery; it cannot be reconciled against the new target');
          }
          const installation = await tx.microsoftTeamsInstallation.findFirst({
            where: { tenantId: destination.tenantId, teamId: destination.teamId, enabled: true },
            select: { id: true },
          });
          if (!installation) throw new Error('Teams installation no longer corresponds to this destination');
          await tx.microsoftTeamsIncidentMessage.upsert({
            where: { incidentId_destinationId: { incidentId: existing.incidentId, destinationId } },
            create: { incidentId: existing.incidentId, destinationId, messageId: body.providerMessageId.trim(), conversationId: body.conversationId.trim(), tenantId: destination.tenantId, teamId: destination.teamId, channelId: destination.channelId },
            update: { messageId: body.providerMessageId.trim(), conversationId: body.conversationId.trim(), tenantId: destination.tenantId, teamId: destination.teamId, channelId: destination.channelId },
          });
          await tx.externalOperation.update({ where: { id: body.id }, data: { status: 'COMPLETED', externalId: body.providerMessageId.trim(), externalKey: body.providerMessageId.trim(), resultPayload: { providerMessageId: body.providerMessageId.trim(), conversationId: body.conversationId.trim(), reconciledManually: true }, lastError: null } });
          await emitAuditEvent({
            action: 'microsoftTeams.delivery.reconciled_delivered', source: 'UI',
            target: { type: 'INCIDENT', id: existing.incidentId }, actor: { type: 'USER', id: admin.user.id },
            oldValue: { status: 'AMBIGUOUS' }, newValue: { status: 'COMPLETED' },
            metadata: { operationId: existing.id, destinationId, tenantId: destination.tenantId, teamId: destination.teamId, channelId: destination.channelId, providerMessageId: body.providerMessageId.trim(), conversationId: body.conversationId.trim() },
          }, tx);
          return;
        }
        if (body.resolution === 'mark_failed') {
          const payload = existing.requestPayload as Record<string, unknown> | null;
          const destinationId = typeof payload?.destinationId === 'string' ? payload.destinationId : '';
          if (existing.incidentId && destinationId) {
            await tx.microsoftTeamsIncidentMessage.deleteMany({ where: { incidentId: existing.incidentId, destinationId, messageId: `__reserved__:${existing.id}` } });
          }
          await tx.externalOperation.update({ where: { id: body.id }, data: { status: 'FAILED', lastError: 'Operator confirmed the ambiguous Teams delivery was not delivered.' } });
          await emitAuditEvent({
            action: 'microsoftTeams.delivery.reconciled_failed', source: 'UI',
            target: { type: 'INCIDENT', id: existing.incidentId }, actor: { type: 'USER', id: admin.user.id },
            oldValue: { status: 'AMBIGUOUS' }, newValue: { status: 'FAILED' },
            metadata: { operationId: existing.id, destinationId },
          }, tx);
          return;
        }
        throw new Error('Ambiguous deliveries cannot be retried; reconcile as mark_delivered or mark_failed');
      }
      if (existing.status !== 'FAILED') {
        throw new Error(`Only FAILED external operations can be retried (current state: ${existing.status})`);
      }
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
      await emitAuditEvent({
        action: existing.provider === 'MICROSOFT_TEAMS' ? 'microsoftTeams.delivery.manual_retry' : 'externalOperation.manual_retry', source: 'UI',
        target: { type: 'INCIDENT', id: existing.incidentId }, actor: { type: 'USER', id: admin.user.id },
        oldValue: { status: 'FAILED' }, newValue: { status: 'PENDING' }, metadata: { operationId: existing.id, provider: existing.provider },
      }, tx);
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
