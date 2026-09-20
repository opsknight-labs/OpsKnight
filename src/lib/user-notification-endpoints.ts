import 'server-only';

import crypto from 'crypto';
import { Prisma, type NotificationChannel, type NotificationEndpointStatus } from '@prisma/client';
import prisma from './prisma';
import { getEncryptionKey } from './encryption';

const UNUSABLE_ENDPOINT_STATUSES: readonly NotificationEndpointStatus[] = [
  'INVALID',
  'BOUNCED',
  'OPTED_OUT',
];

function normalizedEndpointAddress(channel: NotificationChannel, address: string): string {
  const value = address.trim();
  if (channel === 'EMAIL') return value.toLowerCase();
  if (channel === 'SMS' || channel === 'WHATSAPP') return value.replace(/[\s().-]/g, '');
  return value;
}

export function notificationEndpointAddressHash(
  channel: NotificationChannel,
  address: string
): string {
  const key = process.env.NEXTAUTH_SECRET?.trim() || getEncryptionKey();
  if (!key) throw new Error('Notification encryption is not configured');
  const keyBytes = /^[a-f0-9]{64}$/i.test(key)
    ? Buffer.from(key, 'hex')
    : crypto.createHash('sha256').update(key).digest();
  return crypto
    .createHmac('sha256', keyBytes)
    .update(`${channel}\u001f${normalizedEndpointAddress(channel, address)}`)
    .digest('hex');
}

export async function syncUserNotificationEndpoint(input: {
  userId: string;
  channel: NotificationChannel;
  address: string;
}): Promise<{ available: boolean; status: NotificationEndpointStatus }> {
  // Mixed-version deployments may briefly run generated clients from before
  // the endpoint-health migration. Preserve delivery until the new client is live.
  if (!prisma.userNotificationEndpoint) return { available: true, status: 'UNVERIFIED' };
  const addressHash = notificationEndpointAddressHash(input.channel, input.address);
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
  return {
    available: !UNUSABLE_ENDPOINT_STATUSES.includes(endpoint.status),
    status: endpoint.status,
  };
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
  if (!input.addressHash) return;
  const existing = await tx.userNotificationEndpoint.findUnique({
    where: { userId_channel: { userId: input.userId, channel: input.channel } },
    select: { id: true, addressHash: true },
  });
  if (existing) {
    if (existing.addressHash !== input.addressHash) return;
    await tx.userNotificationEndpoint.updateMany({
      where: { id: existing.id, addressHash: input.addressHash },
      data: input.delivered
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
    return;
  }
  try {
    await tx.userNotificationEndpoint.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        addressHash: input.addressHash,
        status: input.delivered ? 'HEALTHY' : (input.terminalStatus ?? 'DEGRADED'),
        failureCount: input.delivered ? 0 : 1,
        lastSuccessAt: input.delivered ? input.occurredAt : undefined,
        lastFailureAt: input.delivered ? undefined : input.occurredAt,
        lastErrorCode: input.errorCode,
        lastVerifiedAt: input.delivered ? input.occurredAt : undefined,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    // A concurrent address refresh won the unique key. Never let this older
    // provider outcome mutate it; a later matching callback can update it.
  }
}
