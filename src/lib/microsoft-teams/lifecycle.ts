import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { emitAuditEvent } from '@/lib/audit';
import { clearMicrosoftTeamsTokenCaches } from './client';

type TeamsRevocationScope = {
  destinationIds?: string[];
  reason: string;
};

/**
 * Settle Teams delivery work without ever converting an unknown external
 * side-effect into a known failure. Callers own the surrounding transaction so
 * routing disablement and delivery fencing commit atomically.
 */
export async function revokeMicrosoftTeamsOperations(
  tx: Prisma.TransactionClient,
  scope: TeamsRevocationScope,
): Promise<{ operationIds: string[]; jobsCancelled: number }> {
  const destinationSet = scope.destinationIds ? new Set(scope.destinationIds) : null;
  const candidates = await tx.externalOperation.findMany({
    where: { provider: 'MICROSOFT_TEAMS', status: { in: ['PENDING', 'PROCESSING', 'AMBIGUOUS'] } },
    select: { id: true, status: true, requestPayload: true, resultPayload: true },
  });
  const operations = candidates.filter(operation => {
    if (!destinationSet) return true;
    const destinationId = (operation.requestPayload as Record<string, unknown> | null)?.destinationId;
    return typeof destinationId === 'string' && destinationSet.has(destinationId);
  });

  for (const operation of operations) {
    const request = operation.requestPayload as Record<string, unknown> | null;
    const destinationId = typeof request?.destinationId === 'string' ? request.destinationId : '';
    const result = operation.resultPayload as Record<string, unknown> | null;
    const remainsAmbiguous = operation.status === 'AMBIGUOUS'
      || (operation.status === 'PROCESSING' && result?.createAttempted === true);
    if (remainsAmbiguous) {
      await tx.microsoftTeamsIncidentMessage.updateMany({
        where: { destinationId, createOperationId: operation.id },
        data: { createState: 'AMBIGUOUS', mutationLeaseToken: null, mutationLeaseExpiresAt: null },
      });
    } else {
      await tx.microsoftTeamsIncidentMessage.deleteMany({
        where: { destinationId, messageId: `__reserved__:${operation.id}` },
      });
      await tx.microsoftTeamsIncidentMessage.updateMany({
        where: { destinationId, createOperationId: operation.id },
        data: { createState: 'NONE', createOperationId: null, mutationLeaseToken: null, mutationLeaseExpiresAt: null },
      });
    }
    await tx.externalOperation.update({
      where: { id: operation.id },
      data: {
        status: remainsAmbiguous ? 'AMBIGUOUS' : 'FAILED',
        nextAttemptAt: remainsAmbiguous ? new Date('9999-12-31T23:59:59.999Z') : new Date(),
        lastError: remainsAmbiguous
          ? `${scope.reason}; the create may have completed and requires manual reconciliation.`
          : `${scope.reason}; queued delivery revoked.`,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  }

  const operationIds = operations.map(operation => operation.id);
  if (operationIds.length === 0) return { operationIds, jobsCancelled: 0 };
  const operationSet = new Set(operationIds);
  const jobs = await tx.backgroundJob.findMany({
    where: { type: 'EXTERNAL_OPERATION', status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true, payload: true },
  });
  const jobIds = jobs.filter(job => {
    const operationId = (job.payload as Record<string, unknown> | null)?.operationId;
    return typeof operationId === 'string' && operationSet.has(operationId);
  }).map(job => job.id);
  if (jobIds.length > 0) {
    await tx.backgroundJob.updateMany({
      where: { id: { in: jobIds } },
      data: { status: 'CANCELLED', completedAt: new Date(), error: scope.reason },
    });
  }
  return { operationIds, jobsCancelled: jobIds.length };
}

export async function disconnectMicrosoftTeamsIntegration(actorId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    const destinations = await tx.microsoftTeamsDestination.findMany({ select: { id: true, serviceId: true } });
    const routedServices = await tx.service.findMany({
      where: { serviceNotificationChannels: { has: 'MICROSOFT_TEAMS' } },
      select: { id: true, serviceNotificationChannels: true },
    });
    await tx.microsoftTeamsConfig.updateMany({ data: { enabled: false } });
    await tx.microsoftTeamsInstallation.updateMany({ data: { enabled: false } });
    await tx.microsoftTeamsDestination.updateMany({ data: { enabled: false } });

    for (const service of routedServices) {
      await tx.service.update({
        where: { id: service.id },
        data: { serviceNotificationChannels: service.serviceNotificationChannels.filter(channel => channel !== 'MICROSOFT_TEAMS') },
      });
    }

    const revoked = await revokeMicrosoftTeamsOperations(tx, {
      reason: 'Microsoft Teams integration disconnected',
    });
    await emitAuditEvent({
      action: 'microsoftTeams.integration.disconnected', source: 'UI',
      target: { type: 'SYSTEM_CONFIG', id: 'microsoft-teams' }, actor: { type: 'USER', id: actorId },
      metadata: { destinationsDisabled: destinations.length, servicesUpdated: routedServices.length, operationsRevoked: revoked.operationIds.length, jobsCancelled: revoked.jobsCancelled },
    }, tx);
  });
  clearMicrosoftTeamsTokenCaches();
}
