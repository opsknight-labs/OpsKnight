import 'server-only';

import { revalidatePath } from 'next/cache';
import type { IncidentStatus } from '@prisma/client';

import {
  assertCanAcknowledgeIncident,
  assertResponderOrAbove,
  getCurrentUser,
} from '@/lib/rbac';
import { AppError } from '@/lib/errors';
import {
  executeIncidentLifecycleCommand,
  transitionIncidentToStatus,
  type IncidentLifecycleSource,
} from '@/lib/incidents/lifecycle';

type OperatorLifecycleSource = Extract<IncidentLifecycleSource, 'WEB' | 'MOBILE'>;

function revalidateIncident(incidentId: string): void {
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/incidents');
  revalidatePath('/');
}

/**
 * Internal application service for human/operator lifecycle changes.
 * Authorization is deliberately performed before the domain command.
 * Typed authorization failures are allowed to cross this boundary unchanged.
 * External effects are persisted transactionally by the lifecycle engine.
 */
export async function updateIncidentStatus(
  id: string,
  status: IncidentStatus,
  expectedStatus: IncidentStatus | undefined,
  source: OperatorLifecycleSource
): Promise<void> {
  if (status === 'ACKNOWLEDGED') await assertCanAcknowledgeIncident(id);
  else await assertResponderOrAbove();

  const result = await transitionIncidentToStatus({
    incidentId: id,
    status,
    expectedStatus,
    source,
  });

  if (result.changed) revalidateIncident(id);
}

export async function resolveIncidentWithNote(
  id: string,
  resolution: string,
  source: OperatorLifecycleSource = 'WEB'
): Promise<void> {
  await assertResponderOrAbove();

  const trimmedResolution = resolution?.trim();
  if (!trimmedResolution || trimmedResolution.length < 10) {
    throw new AppError({
      code: 'INCIDENT_INVALID_ARGUMENT',
      userMessage:
        'Resolution note must be at least 10 characters. Please provide more details about how the incident was resolved.',
      fields: [
        {
          field: 'resolution',
          code: 'too_short',
          message: 'Resolution note must be at least 10 characters.',
        },
      ],
      details: { minLength: 10 },
    });
  }
  if (trimmedResolution.length > 1000) {
    throw new AppError({
      code: 'INCIDENT_INVALID_ARGUMENT',
      userMessage: 'Resolution note must be 1000 characters or fewer. Please shorten your description.',
      fields: [
        {
          field: 'resolution',
          code: 'too_long',
          message: 'Resolution note must be 1000 characters or fewer.',
        },
      ],
      details: { maxLength: 1000 },
    });
  }

  const user = await getCurrentUser();
  const result = await executeIncidentLifecycleCommand({
    incidentId: id,
    command: 'RESOLVE',
    source,
    actor: { id: user.id, name: user.name ?? undefined },
    resolutionNote: trimmedResolution,
  });

  if (result.changed) revalidateIncident(id);
}
