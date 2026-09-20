import 'server-only';

import crypto from 'crypto';
import type { NotificationChannel, NotificationEndpointStatus, Prisma } from '@prisma/client';
import prisma from './prisma';

const UNUSABLE_ENDPOINT_STATUSES: readonly NotificationEndpointStatus[] = [
  'INVALID',
  'BOUNCED',
  'OPTED_OUT',
];

export function notificationEndpointAddressHash(address: string): string {
  return crypto.createHash('sha256').update(address.trim().toLowerCase()).digest('hex');
}

export async function syncUserNotificationEndpoint(input: {
  userId: string;
  channel: NotificationChannel;
  address: string;
}): Promise<{ available: boolean; status: NotificationEndpointStatus }> {
  // Mixed-version deployments may briefly run generated clients from before
  // the endpoint-health migration. Preserve delivery until the new client is live.
  if (!prisma.userNotificationEndpoint) return { available: true, status: 'UNVERIFIED' };
  const addressHash = notificationEndpointAddressHash(input.address);
  const endpoint = await prisma.userNotificationEndpoint.findUnique({
    where: { userId_channel: { userId: input.userId, channel: input.channel } },
  });
  if (!endpoint) {
    const created = await prisma.userNotificationEndpoint.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        addressHash,
        status: 'UNVERIFIED',
      },
      select: { status: true },
    });
    return { available: true, status: created.status };
  }
  if (endpoint.addressHash !== addressHash) {
    await prisma.userNotificationEndpoint.update({
      where: { id: endpoint.id },
      data: {
        addressHash,
        status: 'UNVERIFIED',
        failureCount: 0,
        lastFailureAt: null,
        lastErrorCode: null,
        lastVerifiedAt: null,
      },
    });
    return { available: true, status: 'UNVERIFIED' };
  }
  return { available: !UNUSABLE_ENDPOINT_STATUSES.includes(endpoint.status), status: endpoint.status };
}

export async function recordUserNotificationEndpointOutcome(
  tx: Pick<Prisma.TransactionClient, 'userNotificationEndpoint'>,
  input: {
    userId: string;
    channel: NotificationChannel;
    addressHash?: string | null;
    delivered: boolean;
    errorCode?: string;
    terminalStatus?: Extract<NotificationEndpointStatus, 'INVALID' | 'BOUNCED' | 'OPTED_OUT'>;
    occurredAt: Date;
  }
): Promise<void> {
  await tx.userNotificationEndpoint.upsert({
    where: { userId_channel: { userId: input.userId, channel: input.channel } },
    create: {
      userId: input.userId,
      channel: input.channel,
      addressHash: input.addressHash,
      status: input.delivered ? 'HEALTHY' : input.terminalStatus ?? 'DEGRADED',
      failureCount: input.delivered ? 0 : 1,
      lastSuccessAt: input.delivered ? input.occurredAt : undefined,
      lastFailureAt: input.delivered ? undefined : input.occurredAt,
      lastErrorCode: input.errorCode,
      lastVerifiedAt: input.delivered ? input.occurredAt : undefined,
    },
    update: input.delivered
      ? {
          status: 'HEALTHY',
          failureCount: 0,
          lastSuccessAt: input.occurredAt,
          lastErrorCode: null,
          lastVerifiedAt: input.occurredAt,
        }
      : {
          status: input.terminalStatus ?? 'DEGRADED',
          failureCount: { increment: 1 },
          lastFailureAt: input.occurredAt,
          lastErrorCode: input.errorCode,
        },
  });
}
