import 'server-only';

import type { IncidentEventType, IncidentStatus, Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { AppError } from '@/lib/errors';

export const INCIDENT_LIFECYCLE_COMMANDS = [
  'ACKNOWLEDGE',
  'RESOLVE',
  'REOPEN',
  'UNACKNOWLEDGE',
  'SNOOZE',
  'UNSNOOZE',
  'SUPPRESS',
  'UNSUPPRESS',
] as const;

export type IncidentLifecycleCommand = (typeof INCIDENT_LIFECYCLE_COMMANDS)[number];

export type IncidentLifecycleSource =
  | 'WEB'
  | 'MOBILE'
  | 'REST_API'
  | 'BULK'
  | 'CHATOPS'
  | 'SYSTEM';

export interface IncidentLifecycleActor {
  id?: string;
  name?: string;
}

export interface IncidentLifecycleInput {
  incidentId: string;
  command: IncidentLifecycleCommand;
  source: IncidentLifecycleSource;
  actor?: IncidentLifecycleActor;
  expectedStatus?: IncidentStatus;
  resolutionNote?: string;
  snoozedUntil?: Date | null;
  snoozeReason?: string | null;
  eventMessage?: string;
  /** Test seam. Production callers should use the server/DB clock. */
  now?: Date;
}

export interface IncidentLifecycleResult {
  incidentId: string;
  command: IncidentLifecycleCommand | null;
  source: IncidentLifecycleSource;
  previousStatus: IncidentStatus;
  status: IncidentStatus;
  changed: boolean;
}

type IncidentLifecycleSnapshot = {
  status: IncidentStatus;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  currentEscalationStep: number | null;
  snoozedUntil: Date | null;
  snoozeReason: string | null;
  service: {
    policy: {
      steps: Array<{ delayMinutes: number }>;
    } | null;
  };
};

const MAX_BATCH_SIZE = 100;
const MAX_ID_LENGTH = 100;
const MAX_EVENT_MESSAGE_LENGTH = 2000;
const MAX_SNOOZE_REASON_LENGTH = 1000;
const MIN_RESOLUTION_NOTE_LENGTH = 10;
const MAX_RESOLUTION_NOTE_LENGTH = 1000;

function invalidArgument(userMessage: string, details?: Record<string, unknown>): AppError {
  return new AppError({
    code: 'INCIDENT_INVALID_ARGUMENT',
    userMessage,
    details,
  });
}

function actorSuffix(actor?: IncidentLifecycleActor): string {
  const name = actor?.name?.trim();
  return name ? ` by ${name}` : '';
}

function sameInstant(left: Date | null | undefined, right: Date | null | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.getTime() === right.getTime();
}

function assertInput(input: IncidentLifecycleInput): void {
  if (
    typeof input.incidentId !== 'string' ||
    input.incidentId.length === 0 ||
    input.incidentId.length > MAX_ID_LENGTH
  ) {
    throw invalidArgument('A valid incident ID is required.');
  }

  if (
    input.eventMessage !== undefined &&
    input.eventMessage.trim().length > MAX_EVENT_MESSAGE_LENGTH
  ) {
    throw invalidArgument(
      `Lifecycle event message must be ${MAX_EVENT_MESSAGE_LENGTH} characters or fewer.`
    );
  }

  if ((input.snoozeReason?.length ?? 0) > MAX_SNOOZE_REASON_LENGTH) {
    throw invalidArgument(`Snooze reason must be ${MAX_SNOOZE_REASON_LENGTH} characters or fewer.`);
  }

  if (input.now !== undefined && !Number.isFinite(input.now.getTime())) {
    throw invalidArgument('Lifecycle execution time is invalid.');
  }
}

function normalizeResolutionNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined;
  const normalized = note.trim();
  if (!normalized) return undefined;

  if (
    normalized.length < MIN_RESOLUTION_NOTE_LENGTH ||
    normalized.length > MAX_RESOLUTION_NOTE_LENGTH
  ) {
    throw invalidArgument(
      `Resolution note must be between ${MIN_RESOLUTION_NOTE_LENGTH} and ${MAX_RESOLUTION_NOTE_LENGTH} characters.`,
      {
        minLength: MIN_RESOLUTION_NOTE_LENGTH,
        maxLength: MAX_RESOLUTION_NOTE_LENGTH,
      }
    );
  }

  return normalized;
}

function assertSnoozeInput(input: IncidentLifecycleInput, now: Date): void {
  if (input.command !== 'SNOOZE' || input.snoozedUntil == null) return;

  const value = input.snoozedUntil.getTime();
  if (!Number.isFinite(value) || value <= now.getTime()) {
    throw invalidArgument('Snooze end time must be a valid future date.');
  }
}

function targetStatusFor(command: IncidentLifecycleCommand): IncidentStatus {
  switch (command) {
    case 'ACKNOWLEDGE':
      return 'ACKNOWLEDGED';
    case 'RESOLVE':
      return 'RESOLVED';
    case 'SNOOZE':
      return 'SNOOZED';
    case 'SUPPRESS':
      return 'SUPPRESSED';
    case 'REOPEN':
    case 'UNACKNOWLEDGE':
    case 'UNSNOOZE':
    case 'UNSUPPRESS':
      return 'OPEN';
  }
}

function isAllowedFrom(command: IncidentLifecycleCommand, status: IncidentStatus): boolean {
  switch (command) {
    case 'ACKNOWLEDGE':
    case 'RESOLVE':
    case 'SNOOZE':
    case 'SUPPRESS':
      return (
        status === 'OPEN' ||
        status === 'ACKNOWLEDGED' ||
        status === 'SNOOZED' ||
        status === 'SUPPRESSED'
      );
    case 'REOPEN':
      return status === 'RESOLVED';
    case 'UNACKNOWLEDGE':
      return status === 'ACKNOWLEDGED';
    case 'UNSNOOZE':
      return status === 'SNOOZED';
    case 'UNSUPPRESS':
      return status === 'SUPPRESSED';
  }
}

function isAlreadyApplied(
  incident: IncidentLifecycleSnapshot,
  input: IncidentLifecycleInput,
  targetStatus: IncidentStatus
): boolean {
  if (incident.status !== targetStatus) return false;

  // SNOOZE can update metadata while staying SNOOZED. It is idempotent only
  // when the requested metadata is already committed.
  if (input.command === 'SNOOZE') {
    if (
      input.snoozedUntil !== undefined &&
      !sameInstant(incident.snoozedUntil, input.snoozedUntil)
    ) {
      return false;
    }
    if (
      input.snoozeReason !== undefined &&
      (incident.snoozeReason ?? null) !== (input.snoozeReason ?? null)
    ) {
      return false;
    }
  }

  return true;
}

export function commandForTargetStatus(
  currentStatus: IncidentStatus,
  targetStatus: IncidentStatus
): IncidentLifecycleCommand | null {
  if (currentStatus === targetStatus) return null;

  if (targetStatus === 'ACKNOWLEDGED') return 'ACKNOWLEDGE';
  if (targetStatus === 'RESOLVED') return 'RESOLVE';
  if (targetStatus === 'SNOOZED') return 'SNOOZE';
  if (targetStatus === 'SUPPRESSED') return 'SUPPRESS';

  if (targetStatus === 'OPEN') {
    if (currentStatus === 'ACKNOWLEDGED') return 'UNACKNOWLEDGE';
    if (currentStatus === 'RESOLVED') return 'REOPEN';
    if (currentStatus === 'SNOOZED') return 'UNSNOOZE';
    if (currentStatus === 'SUPPRESSED') return 'UNSUPPRESS';
    return null;
  }

  throw invalidArgument(`Unsupported incident target status: ${targetStatus}.`);
}

async function assertRequiredCustomFieldsPresent(
  tx: Prisma.TransactionClient,
  incidentId: string
): Promise<void> {
  const missing = await tx.customField.findMany({
    where: {
      required: true,
      values: { none: { incidentId, value: { not: '' } } },
    },
    select: { name: true },
  });

  if (missing.length === 0) return;

  const fields = missing.map(field => field.name);
  throw new AppError({
    code: 'INCIDENT_REQUIRED_FIELDS_MISSING',
    userMessage: `Complete required custom fields before resolving: ${fields.join(', ')}`,
    details: { fields },
  });
}

function escalationDelayMinutes(incident: IncidentLifecycleSnapshot, stepIndex: number): number {
  if (!Number.isInteger(stepIndex) || stepIndex < 0) return 0;

  const steps = incident.service.policy?.steps ?? [];
  let index = 0;
  for (const step of steps) {
    if (index === stepIndex) {
      const raw = step.delayMinutes;
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    }
    index += 1;
  }

  return 0;
}

function atDelay(now: Date, delayMinutes: number): Date {
  return new Date(now.getTime() + delayMinutes * 60_000);
}

function eventForCommand(
  input: IncidentLifecycleInput,
  resolutionNote?: string
): { type: IncidentEventType; message: string } {
  const suppliedMessage = input.eventMessage?.trim();
  if (suppliedMessage) {
    switch (input.command) {
      case 'ACKNOWLEDGE':
        return { type: 'ACKNOWLEDGED', message: suppliedMessage };
      case 'RESOLVE':
        return { type: 'MANUAL_RESOLVED', message: suppliedMessage };
      case 'REOPEN':
        return { type: 'REOPENED', message: suppliedMessage };
      case 'UNACKNOWLEDGE':
      case 'SNOOZE':
      case 'UNSNOOZE':
      case 'SUPPRESS':
      case 'UNSUPPRESS':
        return { type: 'STATUS_CHANGE', message: suppliedMessage };
    }
  }

  const suffix = actorSuffix(input.actor);
  switch (input.command) {
    case 'ACKNOWLEDGE':
      return { type: 'ACKNOWLEDGED', message: `Incident acknowledged${suffix}` };
    case 'RESOLVE':
      return {
        type: 'MANUAL_RESOLVED',
        message: resolutionNote ? `Resolved: ${resolutionNote}` : `Incident resolved${suffix}`,
      };
    case 'REOPEN':
      return { type: 'REOPENED', message: `Incident reopened${suffix}` };
    case 'UNACKNOWLEDGE':
      return {
        type: 'STATUS_CHANGE',
        message: `Incident unacknowledged (escalation resumed)${suffix}`,
      };
    case 'SNOOZE':
      return {
        type: 'STATUS_CHANGE',
        message: `Incident snoozed (escalation paused)${suffix}`,
      };
    case 'UNSNOOZE':
      return {
        type: 'STATUS_CHANGE',
        message: `Incident unsnoozed (escalation resumed)${suffix}`,
      };
    case 'SUPPRESS':
      return {
        type: 'STATUS_CHANGE',
        message: `Incident suppressed (escalation paused)${suffix}`,
      };
    case 'UNSUPPRESS':
      return {
        type: 'STATUS_CHANGE',
        message: `Incident unsuppressed (escalation resumed)${suffix}`,
      };
  }
}

function updateDataForCommand(
  incident: IncidentLifecycleSnapshot,
  input: IncidentLifecycleInput,
  now: Date
): Prisma.IncidentUpdateInput {
  const data: Prisma.IncidentUpdateInput = {
    status: targetStatusFor(input.command),
  };

  switch (input.command) {
    case 'ACKNOWLEDGE':
      if (!incident.acknowledgedAt) data.acknowledgedAt = now;
      data.escalationStatus = 'COMPLETED';
      data.nextEscalationAt = null;
      data.snoozedUntil = null;
      data.snoozeReason = null;
      break;

    case 'RESOLVE':
      if (!incident.resolvedAt) data.resolvedAt = now;
      data.escalationStatus = 'COMPLETED';
      data.nextEscalationAt = null;
      data.snoozedUntil = null;
      data.snoozeReason = null;
      break;

    case 'REOPEN': {
      const delayMinutes = escalationDelayMinutes(incident, 0);
      data.resolvedAt = null;
      data.currentEscalationStep = 0;
      data.escalationStatus = 'ESCALATING';
      data.nextEscalationAt = atDelay(now, delayMinutes);
      data.snoozedUntil = null;
      data.snoozeReason = null;
      break;
    }

    case 'UNACKNOWLEDGE': {
      const stepIndex = incident.currentEscalationStep ?? 0;
      data.escalationStatus = 'ESCALATING';
      data.nextEscalationAt = atDelay(now, escalationDelayMinutes(incident, stepIndex));
      data.snoozedUntil = null;
      data.snoozeReason = null;
      break;
    }

    case 'SNOOZE':
      data.escalationStatus = 'PAUSED';
      data.nextEscalationAt = null;
      if (input.snoozedUntil !== undefined) data.snoozedUntil = input.snoozedUntil;
      if (input.snoozeReason !== undefined) data.snoozeReason = input.snoozeReason;
      break;

    case 'UNSNOOZE': {
      const stepIndex = incident.currentEscalationStep ?? 0;
      data.escalationStatus = 'ESCALATING';
      data.nextEscalationAt = atDelay(now, escalationDelayMinutes(incident, stepIndex));
      data.snoozedUntil = null;
      data.snoozeReason = null;
      break;
    }

    case 'SUPPRESS':
      data.escalationStatus = 'PAUSED';
      data.nextEscalationAt = null;
      data.snoozedUntil = null;
      data.snoozeReason = null;
      break;

    case 'UNSUPPRESS':
      data.escalationStatus = 'ESCALATING';
      data.nextEscalationAt = now;
      data.snoozedUntil = null;
      data.snoozeReason = null;
      break;
  }

  return data;
}

async function loadSnapshot(
  tx: Prisma.TransactionClient,
  incidentId: string
): Promise<IncidentLifecycleSnapshot> {
  const incident = await tx.incident.findUnique({
    where: { id: incidentId },
    select: {
      status: true,
      acknowledgedAt: true,
      resolvedAt: true,
      currentEscalationStep: true,
      snoozedUntil: true,
      snoozeReason: true,
      service: {
        select: {
          policy: {
            select: {
              steps: {
                orderBy: { stepOrder: 'asc' },
                select: { delayMinutes: true },
              },
            },
          },
        },
      },
    },
  });

  if (!incident) {
    throw new AppError({
      code: 'INCIDENT_NOT_FOUND',
      userMessage: 'Incident not found.',
      details: { incidentId },
    });
  }

  return incident;
}

/**
 * Transaction-bound primitive. Authentication/authorization intentionally
 * belongs to the application adapter before this domain command is invoked.
 */
export async function applyIncidentLifecycleCommand(
  tx: Prisma.TransactionClient,
  input: IncidentLifecycleInput
): Promise<IncidentLifecycleResult> {
  assertInput(input);
  const now = input.now ?? new Date();
  assertSnoozeInput(input, now);
  const resolutionNote = normalizeResolutionNote(input.resolutionNote);
  const incident = await loadSnapshot(tx, input.incidentId);
  const targetStatus = targetStatusFor(input.command);

  if (isAlreadyApplied(incident, input, targetStatus)) {
    return {
      incidentId: input.incidentId,
      command: input.command,
      source: input.source,
      previousStatus: incident.status,
      status: incident.status,
      changed: false,
    };
  }

  if (input.expectedStatus && incident.status !== input.expectedStatus) {
    throw new AppError({
      code: 'INCIDENT_TRANSITION_CONFLICT',
      userMessage: `Incident changed from ${input.expectedStatus} to ${incident.status}; refresh before applying this update.`,
      details: { expectedStatus: input.expectedStatus, actualStatus: incident.status },
    });
  }

  if (!isAllowedFrom(input.command, incident.status)) {
    throw new AppError({
      code: 'INCIDENT_INVALID_TRANSITION',
      userMessage: `Cannot ${input.command.toLowerCase()} an incident while it is ${incident.status}.`,
      details: { command: input.command, status: incident.status },
    });
  }

  if (input.command === 'RESOLVE') {
    await assertRequiredCustomFieldsPresent(tx, input.incidentId);
  }

  const updateData = updateDataForCommand(incident, input, now);
  const lifecycleEvent = eventForCommand(input, resolutionNote);

  await tx.incident.update({
    where: { id: input.incidentId },
    data: {
      ...updateData,
      events: { create: lifecycleEvent },
    },
  });

  if (input.command === 'RESOLVE' && resolutionNote && input.actor?.id) {
    await tx.incidentNote.create({
      data: {
        incidentId: input.incidentId,
        userId: input.actor.id,
        content: `Resolution: ${resolutionNote}`,
      },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId: input.incidentId,
        type: 'COMMENT',
        message: `Resolution note added by ${input.actor.name?.trim() || 'responder'}`,
      },
    });
  }

  return {
    incidentId: input.incidentId,
    command: input.command,
    source: input.source,
    previousStatus: incident.status,
    status: targetStatus,
    changed: true,
  };
}

export async function executeIncidentLifecycleCommand(
  input: IncidentLifecycleInput
): Promise<IncidentLifecycleResult> {
  return runSerializableTransaction(tx => applyIncidentLifecycleCommand(tx, input));
}

export async function applyIncidentLifecycleTargetStatus(
  tx: Prisma.TransactionClient,
  input: Omit<IncidentLifecycleInput, 'command'> & { status: IncidentStatus }
): Promise<IncidentLifecycleResult> {
  if (
    typeof input.incidentId !== 'string' ||
    input.incidentId.length === 0 ||
    input.incidentId.length > MAX_ID_LENGTH
  ) {
    throw invalidArgument('A valid incident ID is required.');
  }

  const current = await tx.incident.findUnique({
    where: { id: input.incidentId },
    select: { status: true },
  });

  if (!current) {
    throw new AppError({
      code: 'INCIDENT_NOT_FOUND',
      userMessage: 'Incident not found.',
      details: { incidentId: input.incidentId },
    });
  }

  const command = commandForTargetStatus(current.status, input.status);
  if (!command) {
    return {
      incidentId: input.incidentId,
      command: null,
      source: input.source,
      previousStatus: current.status,
      status: current.status,
      changed: false,
    };
  }

  return applyIncidentLifecycleCommand(tx, { ...input, command });
}

export async function transitionIncidentToStatus(
  input: Omit<IncidentLifecycleInput, 'command'> & { status: IncidentStatus }
): Promise<IncidentLifecycleResult> {
  return runSerializableTransaction(tx => applyIncidentLifecycleTargetStatus(tx, input));
}

function validateBatchIds(inputs: readonly { incidentId: string }[]): void {
  if (inputs.length > MAX_BATCH_SIZE) {
    throw invalidArgument(
      `Bulk lifecycle operations are limited to ${MAX_BATCH_SIZE} incidents per request.`,
      { maxBatchSize: MAX_BATCH_SIZE, requested: inputs.length }
    );
  }

  const seen = new Set<string>();
  for (const { incidentId } of inputs) {
    if (
      typeof incidentId !== 'string' ||
      incidentId.length === 0 ||
      incidentId.length > MAX_ID_LENGTH
    ) {
      throw invalidArgument('Bulk lifecycle operations require valid incident IDs.');
    }

    if (seen.has(incidentId)) {
      throw invalidArgument('Bulk lifecycle operations cannot contain duplicate incident IDs.', {
        incidentId,
      });
    }
    seen.add(incidentId);
  }
}

export async function executeIncidentLifecycleBatch(
  inputs: readonly IncidentLifecycleInput[]
): Promise<IncidentLifecycleResult[]> {
  if (inputs.length === 0) return [];
  validateBatchIds(inputs);

  return runSerializableTransaction(async tx => {
    const results: IncidentLifecycleResult[] = [];
    for (const input of inputs) {
      results.push(await applyIncidentLifecycleCommand(tx, input));
    }
    return results;
  });
}

export async function executeIncidentLifecycleTargetBatch(
  inputs: readonly (Omit<IncidentLifecycleInput, 'command'> & { status: IncidentStatus })[]
): Promise<IncidentLifecycleResult[]> {
  if (inputs.length === 0) return [];
  validateBatchIds(inputs);

  return runSerializableTransaction(async tx => {
    const results: IncidentLifecycleResult[] = [];
    for (const input of inputs) {
      results.push(await applyIncidentLifecycleTargetStatus(tx, input));
    }
    return results;
  });
}
