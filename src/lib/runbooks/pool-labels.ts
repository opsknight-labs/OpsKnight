import 'server-only';
import type { Prisma } from '@prisma/client';
import { schedulingLabelsSchema } from './labels';
export { schedulingLabelsSchema } from './labels';
export async function synchronizeLabelMemberships(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runbook-label-memberships'))`;
  const pools = await tx.runbookAgentPool.findMany({ select: { id: true, matchLabels: true } });
  for (const pool of pools) {
    const labels = schedulingLabelsSchema.parse(pool.matchLabels);
    const agents = Object.keys(labels).length
      ? await tx.runbookAgent.findMany({
          where: {
            status: { not: 'REVOKED' },
            AND: Object.entries(labels).map(([key, value]) => ({
              labels: { path: [key], equals: value },
            })),
          },
          select: { id: true },
        })
      : [];
    const ids = agents.map(agent => agent.id);
    await tx.runbookAgentPoolMember.deleteMany({
      where: { poolId: pool.id, source: 'DYNAMIC', agentId: { notIn: ids } },
    });
    if (ids.length)
      await tx.runbookAgentPoolMember.createMany({
        data: ids.map(agentId => ({ poolId: pool.id, agentId, source: 'DYNAMIC' })),
        skipDuplicates: true,
      });
  }
}
