import 'server-only';
import { AppError } from '@/lib/errors';
import { synchronizeLabelMemberships } from './pool-labels';
import {
  runRunbookCommand,
  logRunbookCommandAudit,
  type RunbookCommandActor,
  type RunbookCommandClient,
} from './command-context';

/** Terminal revocation fences enrollment and future claims; existing lease reconciliation remains authoritative. */
export async function revokeRunbookAgent(
  id: string,
  actor: RunbookCommandActor,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  return runRunbookCommand(client, async tx => {
    const existing = await tx.runbookAgent.findUnique({ where: { id } });
    if (!existing)
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Agent not found.' });
    const changed = await tx.runbookAgent.updateMany({
      where: { id, status: { not: 'REVOKED' } },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedById: actorId,
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
      },
    });
    if (changed.count) {
      await synchronizeLabelMemberships(tx);
      await logRunbookCommandAudit(
        actor,
        {
          action: 'runbook.agent.revoked',
          entityType: 'RUNBOOK_AGENT',
          entityId: id,
          actorId,
          details: { name: existing.name },
        },
        tx
      );
    }
    return tx.runbookAgent.findUniqueOrThrow({ where: { id } });
  });
}
