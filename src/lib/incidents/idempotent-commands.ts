import 'server-only';

import type { IncidentStatus } from '@prisma/client';

import { runSerializableTransaction } from '@/lib/db-utils';
import {
  executeIdempotentOperation,
  type IdempotencyContext,
  type IdempotentExecution,
} from '@/lib/idempotency';
import {
  applyIncidentCreation,
  type IncidentCreationInput,
  type IncidentCreationResult,
} from '@/lib/incidents/creation';
import {
  applyIncidentLifecycleCommand,
  applyIncidentLifecycleTargetStatus,
  type IncidentLifecycleInput,
  type IncidentLifecycleResult,
} from '@/lib/incidents/lifecycle';

function lifecyclePayload(input: IncidentLifecycleInput): Record<string, unknown> {
  return {
    incidentId: input.incidentId,
    command: input.command,
    source: input.source,
    actorId: input.actor?.id ?? null,
    expectedStatus: input.expectedStatus ?? null,
    resolutionNote: input.resolutionNote ?? null,
    snoozedUntil: input.snoozedUntil ?? null,
    snoozeReason: input.snoozeReason ?? null,
    eventMessage: input.eventMessage ?? null,
  };
}

function targetPayload(
  input: Omit<IncidentLifecycleInput, 'command'> & { status: IncidentStatus }
): Record<string, unknown> {
  return {
    incidentId: input.incidentId,
    status: input.status,
    source: input.source,
    actorId: input.actor?.id ?? null,
    expectedStatus: input.expectedStatus ?? null,
    resolutionNote: input.resolutionNote ?? null,
    snoozedUntil: input.snoozedUntil ?? null,
    snoozeReason: input.snoozeReason ?? null,
    eventMessage: input.eventMessage ?? null,
  };
}

function creationPayload(input: IncidentCreationInput): Record<string, unknown> {
  return {
    title: input.title,
    description: input.description ?? null,
    serviceId: input.serviceId,
    urgency: input.urgency,
    priority: input.priority ?? null,
    dedupKey: input.dedupKey ?? null,
    assigneeId: input.assigneeId ?? null,
    teamId: input.teamId ?? null,
    visibility: input.visibility ?? 'PUBLIC',
    customFields: [...(input.customFields ?? [])]
      .map(field => ({ fieldId: field.fieldId, value: field.value }))
      .sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
    source: input.source,
    actorId: input.actor?.id ?? null,
  };
}

export async function executeIdempotentIncidentLifecycleCommand(
  input: IncidentLifecycleInput,
  context?: IdempotencyContext
): Promise<IdempotentExecution<IncidentLifecycleResult>> {
  return runSerializableTransaction(tx =>
    executeIdempotentOperation(tx, {
      scope: 'INCIDENT_LIFECYCLE',
      context,
      payload: lifecyclePayload(input),
      execute: () => applyIncidentLifecycleCommand(tx, input),
    })
  );
}

export async function transitionIncidentToStatusIdempotent(
  input: Omit<IncidentLifecycleInput, 'command'> & { status: IncidentStatus },
  context?: IdempotencyContext
): Promise<IdempotentExecution<IncidentLifecycleResult>> {
  return runSerializableTransaction(tx =>
    executeIdempotentOperation(tx, {
      scope: 'INCIDENT_LIFECYCLE_TARGET',
      context,
      payload: targetPayload(input),
      execute: () => applyIncidentLifecycleTargetStatus(tx, input),
    })
  );
}

export async function executeIdempotentIncidentCreation(
  input: IncidentCreationInput,
  context?: IdempotencyContext
): Promise<IdempotentExecution<IncidentCreationResult>> {
  return runSerializableTransaction(tx =>
    executeIdempotentOperation(tx, {
      scope: 'INCIDENT_CREATION',
      context,
      payload: creationPayload(input),
      execute: () => applyIncidentCreation(tx, input),
    })
  );
}
