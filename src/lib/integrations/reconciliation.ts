import prisma from '@/lib/prisma';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

export type IntegrationReconciliationReport = {
  inboundReclaimed: number;
  chatOpsReclaimed: number;
  externalReclaimed: number;
  warRoomsReclaimed: number;
};

/** Recover abandoned leases. Updates are state-and-time fenced, so concurrent
 * schedulers can run this safely and stale workers cannot overwrite recovery. */
export async function reconcileIntegrationControlPlane(
  now = new Date()
): Promise<IntegrationReconciliationReport> {
  const [inbound, chatOpsEffects, chatOpsResponses, external, warRooms] = await prisma.$transaction(
    [
      prisma.inboundDelivery.updateMany({
        where: { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
        data: {
          status: 'FAILED',
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: 'Lease expired; reclaimed for provider retry',
        },
      }),
      prisma.chatOpsIntent.updateMany({
        where: {
          status: 'EFFECT_PROCESSING',
          leaseExpiresAt: { lt: now },
        },
        data: {
          status: 'FAILED',
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: 'Lease expired; reconciliation requested retry',
        },
      }),
      prisma.chatOpsIntent.updateMany({
        where: { status: 'RESPONSE_PROCESSING', leaseExpiresAt: { lt: now } },
        data: {
          status: 'RESPONSE_PENDING',
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: 'Response lease expired; response-only retry requested',
        },
      }),
      prisma.externalOperation.updateMany({
        where: { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
        data: {
          status: 'AMBIGUOUS',
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: now,
          lastError: 'Lease expired; external result requires reconciliation',
        },
      }),
      prisma.incident.updateMany({
        where: {
          warRoomProvisioningStatus: 'PROVISIONING',
          warRoomProvisioningAt: { lt: new Date(now.getTime() - 10 * 60_000) },
        },
        data: { warRoomProvisioningStatus: 'FAILED', warRoomProvisioningToken: null },
      }),
    ]
  );
  const report = {
    inboundReclaimed: inbound.count,
    chatOpsReclaimed: chatOpsEffects.count + chatOpsResponses.count,
    externalReclaimed: external.count,
    warRoomsReclaimed: warRooms.count,
  };
  for (const [kind, count] of Object.entries(report)) {
    if (count) addOperationalMetric('opsknight_integration_reconciliations_total', count, { kind });
  }
  return report;
}
