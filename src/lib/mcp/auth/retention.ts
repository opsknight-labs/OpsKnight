import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

/** Bounded maintenance on the existing scheduler; no new queue or worker. */
export async function cleanupMcpCredentials() {
  const now = new Date();
  // Keep spent credentials for seven days so replay detection survives rotation.
  const cutoff = new Date(now.getTime() - 7 * 86400000);
  const [consents, grants] = await Promise.all([
    prisma.mcpConsentRequest.findMany({
      where: { expiresAt: { lt: cutoff } },
      take: 500,
      orderBy: { expiresAt: 'asc' },
      select: { id: true },
    }),
    prisma.mcpGrant.findMany({
      where: { expiresAt: { lt: cutoff } },
      take: 500,
      orderBy: { expiresAt: 'asc' },
      select: { id: true },
    }),
  ]);
  const removed = await prisma.$transaction([
    prisma.mcpConsentRequest.deleteMany({
      where: { id: { in: consents.map(item => item.id) }, expiresAt: { lt: cutoff } },
    }),
    prisma.mcpGrant.deleteMany({
      where: { id: { in: grants.map(item => item.id) }, expiresAt: { lt: cutoff } },
    }),
  ]);
  // Expire only unused registrations. Active/reusable client identities stay stable.
  const unusedBefore = new Date(now.getTime() - 3600000);
  const clients = await prisma.mcpClient.findMany({
    where: {
      dynamicRegistration: true,
      firstAuthorizedAt: null,
      createdAt: { lt: unusedBefore },
      grants: { none: {} },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 500,
    select: { id: true },
  });
  const registrations = clients.length
    ? await prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "McpClient"
      WHERE id IN (${Prisma.join(clients.map(client => client.id))}) ORDER BY id FOR UPDATE SKIP LOCKED`;
        // Authorization creates consent under a shared client lock, so this snapshot cannot
        // race a new consent insertion between the check and deletion.
        const pending = await tx.mcpConsentRequest.findMany({
          where: {
            clientId: { in: locked.map(client => client.id) },
            consumedAt: null,
            expiresAt: { gt: now },
          },
          select: { clientId: true },
        });
        const inUse = new Set(pending.map(consent => consent.clientId));
        return tx.mcpClient.deleteMany({
          where: {
            id: { in: locked.filter(client => !inUse.has(client.id)).map(client => client.id) },
            dynamicRegistration: true,
            firstAuthorizedAt: null,
            createdAt: { lt: unusedBefore },
            grants: { none: {} },
          },
        });
      })
    : { count: 0 };
  return {
    consents: removed[0].count,
    grants: removed[1].count,
    registrations: registrations.count,
  };
}
