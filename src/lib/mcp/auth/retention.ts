import prisma from '@/lib/prisma';

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
  return { consents: removed[0].count, grants: removed[1].count };
}
