import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { lockResponderPolicy, assertResponderPolicySnapshotSafe } from './automation-snapshot';

/** Publication, default assignment and retirement serialize on the policy row. */
export async function assertPolicyActive(tx: Prisma.TransactionClient, policyId: string) {
  await lockResponderPolicy(tx, policyId);
  const policy = await tx.escalationPolicy.findUnique({
    where: { id: policyId },
    select: { archivedAt: true },
  });
  if (!policy) throw new Error('Escalation policy is missing');
  if (policy.archivedAt)
    throw new Error('Escalation policy is archived. Restore it before creating new references.');
}

export async function transitionPolicyArchive(
  policyId: string,
  actorId: string,
  archived: boolean
) {
  return runSerializableTransaction(async tx => {
    await lockResponderPolicy(tx, policyId);
    const policy = await tx.escalationPolicy.findUniqueOrThrow({ where: { id: policyId } });
    if (archived) {
      const services = await tx.service.findMany({
        where: { escalationPolicyId: policyId },
        select: { name: true },
      });
      const versions = await tx.automationVersionPolicyRef.findMany({
        where: { escalationPolicyId: policyId, version: { activeConfig: { isNot: null } } },
        select: { version: { select: { service: { select: { name: true } } } } },
      });
      if (services.length || versions.length)
        throw new Error(
          `Cannot archive: active service or published automation references remain (${[...services.map(s => s.name), ...versions.map(v => v.version.service.name)].join(', ')}). Replace those routes first. Historical references may remain.`
        );
    } else await assertResponderPolicySnapshotSafe(tx, policyId);
    return tx.escalationPolicy.update({
      where: { id: policyId },
      data: {
        archivedAt: archived ? (policy.archivedAt ?? new Date()) : null,
        archivedBy: archived ? actorId : null,
      },
    });
  });
}
