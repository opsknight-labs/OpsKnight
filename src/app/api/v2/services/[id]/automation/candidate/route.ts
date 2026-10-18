import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { candidateEvidenceFreshness } from '@/lib/automation/evidence-freshness';
import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import { discardCandidate, AutomationConflict } from '@/lib/automation/versioning';
import { preconditionFailed } from '@/lib/api-v2/concurrency';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    await requireAutomationService(prisma, params.id, actor);
    const config = await prisma.serviceAutomationConfig.findUnique({
      where: { serviceId: params.id },
      include: {
        candidateVersion: true,
      },
    });
    if (!config?.candidateVersionId || !config.candidateVersion) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'No published candidate version exists for this service.',
      });
    }

    const candidate = config.candidateVersion;
    const shadowEvidence = await prisma.automationShadowAggregate.findMany({
      where: {
        serviceId: params.id,
        versionId: candidate.id,
        bucketDate: { gte: new Date(Date.now() - 7 * 86400000) },
      },
      orderBy: { bucketDate: 'desc' },
      take: 100,
    });

    const aggregates = shadowEvidence.reduce(
      (acc, row) => ({
        evaluated: acc.evaluated + row.evaluated,
        same: acc.same + row.same,
        routeDifferent: acc.routeDifferent + row.routeDifferent,
        priorityDifferent: acc.priorityDifferent + row.priorityDifferent,
        noEscalationDifferent: acc.noEscalationDifferent + row.noEscalationDifferent,
        errors: acc.errors + row.errors,
        fallbacks: acc.fallbacks + row.fallbacks,
      }),
      {
        evaluated: 0,
        same: 0,
        routeDifferent: 0,
        priorityDifferent: 0,
        noEscalationDifferent: 0,
        errors: 0,
        fallbacks: 0,
      }
    );

    return {
      data: {
        id: candidate.id,
        serviceId: candidate.serviceId,
        versionNumber: candidate.versionNumber,
        publishedAt: candidate.publishedAt.toISOString(),
        publishedBy: candidate.publishedBy,
        checksum: candidate.checksum,
        sourceVersionId: candidate.sourceVersionId,
        lintReport: candidate.lintReport,
        snapshot: candidate.snapshot,
        shadowAggregates: aggregates,
        evidenceFreshness: await candidateEvidenceFreshness(
          prisma,
          params.id,
          candidate.id,
          shadowEvidence[0]?.bucketDate ?? null
        ),
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      expectedCandidateVersionId: z.string().cuid(),
    })
    .strict(),
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    await requireAutomationService(tx ?? prisma, params.id, actor, true);
  },
  handler: async ({ params, body, actor, apiKey, tx }) => {
    await requireAutomationService(tx!, params.id, actor, true);
    try {
      const updated = await discardCandidate(
        {
          serviceId: params.id,
          actorId: actor.id,
          expectedCandidateVersionId: body.expectedCandidateVersionId,
        },
        tx,
        apiKey.id
      );
      return {
        data: {
          serviceId: updated.serviceId,
          activeVersionId: updated.activeVersionId,
          candidateVersionId: updated.candidateVersionId,
        },
        headers: { 'Cache-Control': 'no-store' },
      };
    } catch (error) {
      if (error instanceof AutomationConflict) throw preconditionFailed();
      throw error;
    }
  },
});
