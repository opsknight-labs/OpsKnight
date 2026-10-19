import 'server-only';
import type { Prisma } from '@prisma/client';
import { schedulingLabelsSchema } from './labels';
export { schedulingLabelsSchema } from './labels';
export async function lockFleetConfiguration(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runbook-label-memberships'))`;
  // Advisory locks do not refresh a SERIALIZABLE snapshot established by the
  // retry journal. A real write forces stale waiters to abort/retry even when
  // the earlier grant writer used READ COMMITTED. Reentrant writes are safe.
  await tx.$executeRaw`INSERT INTO "RunbookFleetAuthority" (id, revision) VALUES ('default', 1)
    ON CONFLICT (id) DO UPDATE SET revision = "RunbookFleetAuthority".revision + 1`;
}
/** Concurrent claims share the fence; administrative membership/grant changes own it exclusively. */
export async function lockFleetClaim(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('runbook-label-memberships'))`;
}

/** Reconcile one identity without loading or querying the rest of the fleet. */
export async function synchronizeAgentLabelMemberships(
  tx: Prisma.TransactionClient,
  agentId: string
) {
  await lockFleetConfiguration(tx);
  await tx.$executeRaw`DELETE FROM "RunbookAgentPoolMember" m
    USING "RunbookAgent" a, "RunbookAgentPool" p
    WHERE m."agentId" = ${agentId} AND a.id = m."agentId" AND p.id = m."poolId"
      AND m.source = 'DYNAMIC'
      AND (a.status = 'REVOKED' OR p.lifecycle <> 'ACTIVE' OR p."matchLabels" = '{}'::jsonb
        OR NOT (a.labels @> p."matchLabels"))`;
  // Prisma's client-side cuid default is unavailable to INSERT SELECT. Generate
  // cryptographic UUIDs in PostgreSQL with a CUID-compatible prefix/encoding.
  await tx.$executeRaw`INSERT INTO "RunbookAgentPoolMember" (id, "poolId", "agentId", source, "createdAt")
    SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), p.id, a.id, 'DYNAMIC', CURRENT_TIMESTAMP
    FROM "RunbookAgentPool" p CROSS JOIN "RunbookAgent" a
    WHERE a.id = ${agentId} AND a.status <> 'REVOKED'
      AND p.lifecycle = 'ACTIVE' AND p."matchLabels" <> '{}'::jsonb AND a.labels @> p."matchLabels"
      AND NOT EXISTS (SELECT 1 FROM "RunbookAgentPoolMember" m WHERE m."poolId" = p.id AND m."agentId" = a.id)
    ON CONFLICT ("poolId", "agentId") DO NOTHING`;
}
export async function synchronizeLabelMemberships(tx: Prisma.TransactionClient, poolId?: string) {
  await lockFleetConfiguration(tx);
  const pools = await tx.runbookAgentPool.findMany({
    where: { lifecycle: 'ACTIVE', ...(poolId ? { id: poolId } : {}) },
    select: { id: true, matchLabels: true },
  });
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
