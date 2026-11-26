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

const BLOCKED_ENDPOINT_STATUSES: readonly NotificationEndpointStatus[] = ['BOUNCED', 'OPTED_OUT'];
const HASH_KEY_CONFIG = 'notification_endpoint_hash_key';

function endpointHashKeyBytes(): Buffer {
  const key = process.env.NEXTAUTH_SECRET?.trim() || getEncryptionKey();
  if (!key) throw new Error('Notification encryption is not configured');
  return /^[a-f0-9]{64}$/i.test(key)
    ? Buffer.from(key, 'hex')
    : crypto.createHash('sha256').update(key).digest();
}

let hashKeyChangedAtCache: Promise<Date | null> | undefined;

/** Test hook: forget the cached hash-key state. */
export function resetEndpointHashKeyStateForTests() {
  hashKeyChangedAtCache = undefined;
}

/**
 * When the address-hash key last changed, or null if it has not since this was first recorded.
 * The hash key is NEXTAUTH_SECRET, so rotating it re-hashes every address; recording a key
 * fingerprint lets a mismatch be told apart from a person genuinely changing their address.
 */
function hashKeyChangedAt(): Promise<Date | null> {
  hashKeyChangedAtCache ??= (async () => {
    const keyId = crypto
      .createHmac('sha256', endpointHashKeyBytes())
      .update('opsknight:endpoint-hash-key-id')
      .digest('hex')
      .slice(0, 16);
    const row = await prisma.systemConfig.findUnique({ where: { key: HASH_KEY_CONFIG } });
    const stored = row?.value as { keyId?: string; changedAt?: string | null } | null | undefined;
    if (stored?.keyId === keyId) return stored.changedAt ? new Date(stored.changedAt) : null;
    const changedAt = stored?.keyId ? new Date() : null;
    const value = { keyId, changedAt: changedAt?.toISOString() ?? null };
    await prisma.systemConfig.upsert({
      where: { key: HASH_KEY_CONFIG },
      create: { key: HASH_KEY_CONFIG, value },
      update: { value },
    });
    return changedAt;
  })().catch(() => {
    hashKeyChangedAtCache = undefined; // do not cache a failed read
    return null;
  });
  return hashKeyChangedAtCache;
}

function normalizedEndpointAddress(channel: NotificationChannel, address: string): string {
  const value = address.trim();
  if (channel === 'EMAIL') return value.toLowerCase();
  if (channel === 'SMS' || channel === 'VOICE' || channel === 'WHATSAPP')
    return value.replace(/[\s().-]/g, '');
  return value;
}

export function notificationEndpointAddressHash(
  channel: NotificationChannel,
  address: string
): string {
  return crypto
    .createHmac('sha256', endpointHashKeyBytes())
    .update(`${channel}\u001f${normalizedEndpointAddress(channel, address)}`)
    .digest('hex');
}

export async function syncUserNotificationEndpoint(
  input: { userId: string; channel: NotificationChannel; address: string },
  store: Pick<Prisma.TransactionClient, 'userNotificationEndpoint'> = prisma
): Promise<{ available: boolean; status: NotificationEndpointStatus }> {
  // Mixed-version deployments may briefly run generated clients from before
  // the endpoint-health migration. Preserve delivery until the new client is live.
  if (!store.userNotificationEndpoint) return { available: true, status: 'UNVERIFIED' };
  const addressHash = notificationEndpointAddressHash(input.channel, input.address);
  const keyChangedAt = await hashKeyChangedAt();
  const endpoint =
    typeof store.userNotificationEndpoint.upsert === 'function'
      ? await store.userNotificationEndpoint.upsert({
          where: { userId_channel: { userId: input.userId, channel: input.channel } },
          create: {
            userId: input.userId,
            channel: input.channel,
            addressHash,
            status: 'UNVERIFIED',
          },
          update: {},
        })
      : ((await store.userNotificationEndpoint.findUnique({
          where: { userId_channel: { userId: input.userId, channel: input.channel } },
        })) ??
        (await store.userNotificationEndpoint.create({
          data: {
            userId: input.userId,
            channel: input.channel,
            addressHash,
            status: 'UNVERIFIED',
          },
        })));
  if (endpoint.addressHash !== addressHash) {
    // The hash key changed after this row was last written, so the mismatch is the rotation, not a
    // new address: keep the provider's bounce or opt-out and only re-stamp the hash.
    if (
      BLOCKED_ENDPOINT_STATUSES.includes(endpoint.status) &&
      keyChangedAt &&
      endpoint.updatedAt < keyChangedAt
    ) {
      await store.userNotificationEndpoint.update({
        where: { id: endpoint.id },
        data: { addressHash },
      });
      return { available: false, status: endpoint.status };
    }
    await store.userNotificationEndpoint.update({
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
