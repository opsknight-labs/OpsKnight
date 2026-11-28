import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import {
  notificationEndpointAddressHash,
  recordUserNotificationEndpointOutcome,
  resetUserNotificationEndpoint,
} from '@/lib/user-notification-endpoints';

vi.mock('@/lib/encryption', () => ({ getEncryptionKey: () => '11'.repeat(32) }));

const address = 'person@example.com';
const addressHash = notificationEndpointAddressHash('EMAIL', address);

beforeEach(async () => {
  await resetDatabase();
}, 30_000);
afterAll(async () => {
  await db.$disconnect();
});

async function bouncedEndpoint() {
  const user = await db.user.create({
    data: { name: 'Fence', email: 'fence@example.com', role: 'USER' },
  });
  await db.userNotificationEndpoint.create({
    data: { userId: user.id, channel: 'EMAIL', addressHash, status: 'BOUNCED', failureCount: 1 },
  });
  return user;
}

const bounce = (userId: string, occurredAt: Date) =>
  prisma.$transaction(tx =>
    recordUserNotificationEndpointOutcome(tx, {
      userId,
      channel: 'EMAIL',
      addressHash,
      delivered: false,
      terminalStatus: 'BOUNCED',
      occurredAt,
    })
  );

const statusOf = async (userId: string) =>
  (await db.userNotificationEndpoint.findFirstOrThrow({ where: { userId } })).status;

it('a delayed bounce older than an operator reset cannot undo the reset', async () => {
  const user = await bouncedEndpoint();
  await resetUserNotificationEndpoint({ userId: user.id, channel: 'EMAIL', actorId: user.id });
  expect(await statusOf(user.id)).toBe('UNVERIFIED');

  await bounce(user.id, new Date(Date.now() - 60_000));

  expect(await statusOf(user.id)).toBe('UNVERIFIED');
});

it('a bounce the provider observed after the reset blocks the endpoint again', async () => {
  const user = await bouncedEndpoint();
  await resetUserNotificationEndpoint({ userId: user.id, channel: 'EMAIL', actorId: user.id });

  await bounce(user.id, new Date(Date.now() + 60_000));

  expect(await statusOf(user.id)).toBe('BOUNCED');
});

it('an endpoint that was never reset still takes its first failure', async () => {
  const user = await db.user.create({
    data: { name: 'Fresh', email: 'fresh@example.com', role: 'USER' },
  });
  await db.userNotificationEndpoint.create({
    data: { userId: user.id, channel: 'EMAIL', addressHash, status: 'UNVERIFIED' },
  });

  await bounce(user.id, new Date(Date.now() - 60_000));

  expect(await statusOf(user.id)).toBe('BOUNCED');
});
