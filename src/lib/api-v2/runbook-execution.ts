import type { Prisma } from '@prisma/client';
import type { z } from 'zod/v3';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { RunbookExecuteV2Schema } from './validation';
import { AppError } from '@/lib/errors';

/** Shared REST boundary: previews and starts resolve the same reviewed rule and inputs. */
export async function resolveV2RunbookExecution(
  db: Prisma.TransactionClient,
  params: { id: string },
  body: z.infer<typeof RunbookExecuteV2Schema>,
  actor: AuthorizationActor
) {
  const { id } = params;
  const findBinding = async ({ where }: { where: Prisma.ServiceAutomationRuleWhereInput }) => {
    const matches = await db.serviceAutomationRule.findMany({
      where: { ...where, detachedAt: null },
      orderBy: { id: 'asc' },
      take: 2,
    });
    if (matches.length > 1)
      throw new AppError({
        code: 'RUNBOOK_DEFINITION_INVALID',
        userMessage:
          'Multiple service rules match this Runbook. Specify bindingId to select the reviewed rule.',
      });
    return matches[0] ?? null;
  };

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
    const binding = await findBinding({
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
    const binding = await findBinding({
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
    const binding = await findBinding({
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

  if (resolvedBindingId && Object.keys(body.parameters).length > 0)
    throw new AppError({
      code: 'RUNBOOK_DEFINITION_INVALID',
      userMessage:
        'Service rules use their saved inputs. Per-execution parameters are not accepted for a bound rule. Update and review the rule configuration, or execute the Runbook without a service rule.',
    });

  return {
    runbookId: id,
    runbookVersionId: resolvedRunbookVersionId,
    serviceId: resolvedServiceId,
    bindingId: resolvedBindingId,
    incidentId: body.incidentId ?? undefined,
    triggeredByUserId: actor.id,
    inputValues: body.parameters,
  };
}
