import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { clearMicrosoftTeamsTokenCaches } from './client';

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

    const operations = await tx.externalOperation.findMany({
      where: { provider: 'MICROSOFT_TEAMS', status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, status: true, requestPayload: true, resultPayload: true },
    });
    const revokedIds: string[] = [];
    for (const operation of operations) {
      const request = operation.requestPayload as Record<string, unknown> | null;
      const destinationId = typeof request?.destinationId === 'string' ? request.destinationId : '';
      const result = operation.resultPayload as Record<string, unknown> | null;
      const createMayHaveRun = operation.status === 'PROCESSING' && result?.createAttempted === true;
      if (createMayHaveRun) {
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
          status: createMayHaveRun ? 'AMBIGUOUS' : 'FAILED',
          nextAttemptAt: createMayHaveRun ? new Date('9999-12-31T23:59:59.999Z') : new Date(),
          lastError: createMayHaveRun
            ? 'Teams disconnected while a create may have been in flight; manual reconciliation required.'
            : 'Microsoft Teams integration disconnected; queued delivery revoked.',
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      revokedIds.push(operation.id);
    }

    const jobs = await tx.backgroundJob.findMany({
      where: { type: 'EXTERNAL_OPERATION', status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true, payload: true },
    });
    const revokedSet = new Set(revokedIds);
    const jobIds = jobs.filter(job => {
      const operationId = (job.payload as Record<string, unknown> | null)?.operationId;
      return typeof operationId === 'string' && revokedSet.has(operationId);
    }).map(job => job.id);
    if (jobIds.length > 0) {
      await tx.backgroundJob.updateMany({
        where: { id: { in: jobIds } },
        data: { status: 'CANCELLED', completedAt: new Date(), error: 'Microsoft Teams integration disconnected' },
      });
    }
    await emitAuditEvent({
      action: 'microsoftTeams.integration.disconnected', source: 'UI',
      target: { type: 'SYSTEM_CONFIG', id: 'microsoft-teams' }, actor: { type: 'USER', id: actorId },
      metadata: { destinationsDisabled: destinations.length, servicesUpdated: routedServices.length, operationsRevoked: revokedIds.length, jobsCancelled: jobIds.length },
    }, tx);
  });
  clearMicrosoftTeamsTokenCaches();
}
