import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { incidentReadWhere } from '@/lib/authorization-filters';
import {
  applyIncidentLifecycleCommand,
  type IncidentLifecycleCommand,
} from '@/lib/incidents/lifecycle';
import type { V2RouteContext } from './endpoint';
import { logV2Audit } from './audit';

export const IncidentLifecycleV2Schema = z
  .object({
    expectedStatus: z
      .enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'])
      .optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export async function applyV2IncidentLifecycle(
  {
    params,
    body,
    actor,
    apiKey,
    tx,
  }: V2RouteContext<
    { id: string },
    unknown,
    z.infer<typeof IncidentLifecycleV2Schema> & { snoozedUntil?: string }
  >,
  command: IncidentLifecycleCommand
) {
  if (!tx) throw new AppError({ code: 'INTERNAL_ERROR' });
  const incident = await tx.incident.findFirst({
    where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
    select: { id: true },
  });
  if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
  const result = await applyIncidentLifecycleCommand(tx, {
    incidentId: incident.id,
    command,
    source: 'REST_API',
    actor: { id: actor.id },
    expectedStatus: body.expectedStatus,
    eventMessage: body.note,
    ...(command === 'SNOOZE'
      ? { snoozedUntil: new Date(body.snoozedUntil!), snoozeReason: body.note }
      : {}),
  });
  await logV2Audit({
    action: `incident.${command.toLowerCase()}`,
    entityType: 'INCIDENT',
    entityId: incident.id,
    actorId: actor.id,
    apiKeyId: apiKey.id,
    details: {
      command,
      previousStatus: result.previousStatus,
      status: result.status,
      changed: result.changed,
    },
    tx,
  });
  return result;
}
