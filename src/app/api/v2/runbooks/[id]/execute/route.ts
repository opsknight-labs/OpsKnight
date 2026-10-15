import prisma from '@/lib/prisma';
import { defineV2Route, logV2Audit, RunbookExecuteV2Schema } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { previewRunbookExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import { AppError } from '@/lib/errors';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { z } from 'zod';

export const POST = defineV2Route<{ id: string }, unknown, z.infer<typeof RunbookExecuteV2Schema>>({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
  bodySchema: RunbookExecuteV2Schema,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params, body }) =>
    `runbook:execute:${params.id}:${body.incidentId ?? 'global'}`,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const db = tx ?? prisma;
    const { id } = params;

    const runbook = await db.runbook.findUnique({
      where: { id },
      select: { id: true, name: true, archivedAt: true, publishedVersionId: true },
    });

    if (!runbook || runbook.archivedAt || !runbook.publishedVersionId) {
      throw new AppError({
        code: 'RUNBOOK_NOT_FOUND',
        userMessage: `Runbook with id '${id}' was not found or is not published.`,
      });
    }

    let resolvedServiceId: string | undefined;
    let resolvedBindingId: string | undefined;
    let resolvedRunbookVersionId: string | undefined = runbook.publishedVersionId;

    if (body.incidentId) {
      // The canonical read filter decides visibility, so an incident the caller cannot read is
      // indistinguishable from a missing one and no access rule is duplicated here.
      const incident = await db.incident.findFirst({
        where: { AND: [{ id: body.incidentId }, incidentReadWhere(actor)] },
        include: {
          service: { select: { id: true, name: true, teamId: true } },
          watchers: { select: { userId: true } },
        },
      });

      if (!incident) {
        throw new AppError({
          code: 'INCIDENT_NOT_FOUND',
          userMessage: `Incident with id '${body.incidentId}' was not found.`,
        });
      }

      if (body.serviceId && body.serviceId !== incident.serviceId) {
        throw new AppError({
          code: 'RUNBOOK_DEFINITION_INVALID',
          userMessage: `Incident '${body.incidentId}' does not belong to specified service '${body.serviceId}'.`,
        });
      }

      resolvedServiceId = incident.serviceId;

      // Establish the correct runbook-service binding
      const binding = await db.serviceRunbookBinding.findFirst({
        where: {
          ...(body.bindingId ? { id: body.bindingId } : {}),
          runbookId: id,
          serviceId: incident.serviceId,
          enabled: true,
        },
      });

      if (!binding) {
        throw new AppError({
          code: 'RUNBOOK_DEFINITION_INVALID',
          userMessage: `Runbook '${id}' is not bound to service '${incident.serviceId}' or the binding is disabled.`,
        });
      }

      resolvedBindingId = binding.id;
      if (binding.versionStrategy === 'PINNED' && binding.runbookVersionId) {
        resolvedRunbookVersionId = binding.runbookVersionId;
      }
    } else if (body.bindingId) {
      const binding = await db.serviceRunbookBinding.findFirst({
        where: {
          id: body.bindingId,
          runbookId: id,
          enabled: true,
          ...(body.serviceId ? { serviceId: body.serviceId } : {}),
        },
      });

      if (!binding) {
        throw new AppError({
          code: 'RUNBOOK_DEFINITION_INVALID',
          userMessage: `Runbook binding '${body.bindingId}' was not found or is disabled.`,
        });
      }

      resolvedServiceId = binding.serviceId;
      resolvedBindingId = binding.id;
      if (binding.versionStrategy === 'PINNED' && binding.runbookVersionId) {
        resolvedRunbookVersionId = binding.runbookVersionId;
      }
    } else if (body.serviceId) {
      resolvedServiceId = body.serviceId;
      const binding = await db.serviceRunbookBinding.findFirst({
        where: {
          runbookId: id,
          serviceId: body.serviceId,
          enabled: true,
        },
      });
      if (binding) {
        resolvedBindingId = binding.id;
        if (binding.versionStrategy === 'PINNED' && binding.runbookVersionId) {
          resolvedRunbookVersionId = binding.runbookVersionId;
        }
      }
    }

    // 1. Preview execution boundary and generate authorized execution plan
    const preview = await previewRunbookExecution(
      {
        runbookId: id,
        runbookVersionId: resolvedRunbookVersionId,
        serviceId: resolvedServiceId,
        bindingId: resolvedBindingId,
        incidentId: body.incidentId ?? undefined,
        triggeredByUserId: actor.id,
        inputValues: body.parameters,
      },
      tx
    );

    // 2. Start asynchronous execution with preflight digest & preview token
    const execution = await startRunbookExecution(
      {
        runbookId: id,
        runbookVersionId: resolvedRunbookVersionId,
        serviceId: resolvedServiceId,
        bindingId: resolvedBindingId,
        incidentId: body.incidentId ?? undefined,
        triggeredByUserId: actor.id,
        inputValues: body.parameters,
        expectedPlanDigest: preview.digest,
        previewAuthorizationToken: preview.authorizationToken,
      },
      tx
    );

    await logV2Audit({
      action: 'runbook.execution_started',
      entityType: 'RUNBOOK',
      entityId: id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        executionId: execution.id,
        incidentId: body.incidentId ?? null,
        serviceId: resolvedServiceId ?? null,
        bindingId: resolvedBindingId ?? null,
      },
      tx,
    });

    return {
      status: 202,
      data: {
        executionId: execution.id,
        status: execution.status,
        runbookId: id,
        incidentId: body.incidentId ?? null,
        serviceId: resolvedServiceId ?? null,
        message: 'Runbook execution initiated. Poll /api/v2/runbooks/executions/:id for status.',
      },
    };
  },
});
