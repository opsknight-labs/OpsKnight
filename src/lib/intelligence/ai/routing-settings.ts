import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { parseOrThrow, type IntelligenceActor } from '../settings/service';
import { aiRoutingInputSchema, ROUTABLE_CAPABILITIES } from './routing';
import { getAiSettings, type AiSettingsView } from './settings';

/**
 * Saves the investigation switch and per-capability routing. Caller must authorize INTELLIGENCE_MANAGE.
 * Shares the AI settings revision (compare-and-set) and lock with the general form, so two administrators
 * can never silently overwrite each other, and commits its audit entry atomically. Every routed provider
 * must exist; whether it may receive a given request is still decided per request by the data policy.
 */
export async function updateAiRouting(
  input: unknown,
  actor: IntelligenceActor
): Promise<AiSettingsView> {
  const { expectedRevision, capabilityRouting, squireInvestigationEnabled } = parseOrThrow(
    aiRoutingInputSchema,
    input
  );
  const providerIds = [
    ...new Set(
      Object.values(capabilityRouting).flatMap(route => (route ? [route.providerId] : []))
    ),
  ];
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ai-settings', 0))`;
    const previous = await getAiSettings(tx);
    if (previous.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    if (providerIds.length) {
      const known = new Set(
        (
          await tx.aiProvider.findMany({
            where: { id: { in: providerIds } },
            select: { id: true },
          })
        ).map(row => row.id)
      );
      const missing = ROUTABLE_CAPABILITIES.find(capability => {
        // eslint-disable-next-line security/detect-object-injection -- capability is a member of a fixed list
        const route = capabilityRouting[capability];
        return route && !known.has(route.providerId);
      });
      if (missing)
        throw new AppError({
          code: 'VALIDATION_FAILED',
          fields: [
            {
              field: `capabilityRouting.${missing}`,
              code: 'custom',
              message: 'That provider no longer exists',
            },
          ],
        });
    }
    const stored =
      Object.keys(capabilityRouting).length > 0
        ? (capabilityRouting as Prisma.InputJsonValue)
        : Prisma.DbNull;
    await tx.aiSettings.upsert({
      where: { id: 'default' },
      create: {
        capabilityRouting: stored,
        squireInvestigationEnabled,
        revision: 1,
        updatedBy: actor.actorId,
      },
      update: {
        capabilityRouting: stored,
        squireInvestigationEnabled,
        revision: { increment: 1 },
        updatedBy: actor.actorId,
      },
      select: { id: true },
    });
    const next = await getAiSettings(tx);
    await logAudit(
      {
        action: 'intelligence.ai.routing.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'ai',
        actorId: actor.actorId,
        source: actor.source,
        ...(actor.source === 'API' ? { details: { apiClientId: actor.apiClientId } } : {}),
        oldValue: {
          capabilityRouting: { ...previous.capabilityRouting },
          squireInvestigationEnabled: previous.squireInvestigationEnabled ?? false,
          revision: previous.revision,
        },
        newValue: {
          capabilityRouting: { ...next.capabilityRouting },
          squireInvestigationEnabled: next.squireInvestigationEnabled ?? false,
          revision: next.revision,
        },
      },
      tx
    );
    return next;
  });
}
