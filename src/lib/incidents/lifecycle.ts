import 'server-only';

import type { IncidentEventType, IncidentStatus, Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';

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

export type IncidentLifecycleErrorCode =
  | 'INCIDENT_NOT_FOUND'
  | 'INCIDENT_STATE_CONFLICT'
  | 'INCIDENT_INVALID_TRANSITION'
  | 'INCIDENT_REQUIRED_FIELDS_MISSING'
  | 'INCIDENT_INVALID_ARGUMENT';

export class IncidentLifecycleError extends Error {
  readonly code: IncidentLifecycleErrorCode;
  readonly status: 400 | 404 | 409 | 422;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: IncidentLifecycleErrorCode,
    message: string,
    status: 400 | 404 | 409 | 422,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = 'IncidentLifecycleError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

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
  /**
   * Primarily a test seam. Production callers should normally use the DB/server
   * clock at command execution time rather than calculating lifecycle timestamps
   * at the HTTP/UI edge.
   */
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
  id: string;
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

const ACTIVE_STATUSES: readonly IncidentStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'SNOOZED',
  'SUPPRESSED',
];

const TARGET_STATUS: Record<IncidentLifecycleCommand, IncidentStatus> = {
  ACKNOWLEDGE: 'ACKNOWLEDGED',
  RESOLVE: 'RESOLVED',
  REOPEN: 'OPEN',
  UNACKNOWLEDGE: 'OPEN',
  SNOOZE: 'SNOOZED',
  UNSNOOZE: 'OPEN',
  SUPPRESS: 'SUPPRESSED',
  UNSUPPRESS: 'OPEN',
};

const ALLOWED_FROM: Record<IncidentLifecycleCommand, readonly IncidentStatus[]> = {
  ACKNOWLEDGE: ACTIVE_STATUSES,
  RESOLVE: ACTIVE_STATUSES,
  REOPEN: ['RESOLVED'],
  UNACKNOWLEDGE: ['ACKNOWLEDGED'],
  SNOOZE: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'],
  UNSNOOZE: ['SNOOZED'],
  SUPPRESS: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'],
  UNSUPPRESS: ['SUPPRESSED'],
};

const MAX_BATCH_SIZE = 100;
const MAX_ID_LENGTH = 100;
const MAX_EVENT_MESSAGE_LENGTH = 2000;
const MAX_SNOOZE_REASON_LENGTH = 1000;
const MIN_RESOLUTION_NOTE_LENGTH = 10;
const MAX_RESOLUTION_NOTE_LENGTH = 1000;

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
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_ARGUMENT',
      'A valid incident ID is required.',
      400
    );
  }

  if (input.eventMessage !== undefined && input.eventMessage.trim().length > MAX_EVENT_MESSAGE_LENGTH) {
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_ARGUMENT',
      `Lifecycle event message must be ${MAX_EVENT_MESSAGE_LENGTH} characters or fewer.`,
      400
    );
  }

  if ((input.snoozeReason?.length ?? 0) > MAX_SNOOZE_REASON_LENGTH) {
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_ARGUMENT',
      `Snooze reason must be ${MAX_SNOOZE_REASON_LENGTH} characters or fewer.`,
      400
    );
  }

  if (input.now !== undefined && !Number.isFinite(input.now.getTime())) {
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_ARGUMENT',
      'Lifecycle execution time is invalid.',
      400
    );
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
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_ARGUMENT',
      `Resolution note must be between ${MIN_RESOLUTION_NOTE_LENGTH} and ${MAX_RESOLUTION_NOTE_LENGTH} characters.`,
      400,
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
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_ARGUMENT',
      'Snooze end time must be a valid future date.',
      400
    );
  }
}

function targetStatusFor(command: IncidentLifecycleCommand): IncidentStatus {
  return TARGET_STATUS[command];
}

function isAlreadyApplied(
  incident: IncidentLifecycleSnapshot,
  input: IncidentLifecycleInput,
  targetStatus: IncidentStatus
): boolean {
  if (incident.status !== targetStatus) return false;

  // An explicit SNOOZE command may legitimately extend/change an existing
  // snooze. Treat it as an idempotent no-op only when the supplied metadata is
  // already present as well.
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

  throw new IncidentLifecycleError(
    'INCIDENT_INVALID_ARGUMENT',
    `Unsupported incident target status: ${targetStatus}.`,
    400
  );
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
  throw new IncidentLifecycleError(
    'INCIDENT_REQUIRED_FIELDS_MISSING',
    `Complete required custom fields before resolving: ${fields.join(', ')}`,
    422,
    { fields }
  );
}

function escalationDelayMinutes(incident: IncidentLifecycleSnapshot, stepIndex: number): number {
  const raw = incident.service.policy?.steps?.[stepIndex]?.delayMinutes ?? 0;
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
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
    const type: IncidentEventType =
      input.command === 'ACKNOWLEDGE'
        ? 'ACKNOWLEDGED'
        : input.command === 'RESOLVE'
          ? 'MANUAL_RESOLVED'
          : input.command === 'REOPEN'
            ? 'REOPENED'
            : 'STATUS_CHANGE';
    return { type, message: suppliedMessage };
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
      // acknowledgedAt represents first acknowledgement for SLA/MTTA and must
      // never be erased/re-written by unacknowledge/reopen operations.
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
      const delayMinutes = escalationDelayMinutes(incident, stepIndex);
      data.escalationStatus = 'ESCALATING';
      data.nextEscalationAt = atDelay(now, delayMinutes);
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
      const delayMinutes = escalationDelayMinutes(incident, stepIndex);
      data.escalationStatus = 'ESCALATING';
      data.nextEscalationAt = atDelay(now, delayMinutes);
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
      id: true,
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
    throw new IncidentLifecycleError('INCIDENT_NOT_FOUND', 'Incident not found.', 404);
  }

  return incident;
}

/**
 * Transaction-bound primitive for adapters that need lifecycle state changes
 * to commit atomically with adjacent database-only changes.
 *
 * Authorization intentionally does not live here. Every entry adapter must
 * authenticate/authorize before invoking the domain command, so the domain
 * service remains reusable by web, API, bulk and future ChatOps adapters.
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

  // Idempotent retry semantics come before optimistic concurrency checks.
  // A retry after a successful commit must be a no-op even if the caller's
  // expected source state is now stale.
  if (isAlreadyApplied(incident, input, targetStatus)) {
    return {
      incidentId: incident.id,
      command: input.command,
      source: input.source,
      previousStatus: incident.status,
      status: incident.status,
      changed: false,
    };
  }

  if (input.expectedStatus && incident.status !== input.expectedStatus) {
    throw new IncidentLifecycleError(
      'INCIDENT_STATE_CONFLICT',
      `Incident changed from ${input.expectedStatus} to ${incident.status}; refresh before applying this update.`,
      409,
      { expectedStatus: input.expectedStatus, actualStatus: incident.status }
    );
  }

  if (!ALLOWED_FROM[input.command].includes(incident.status)) {
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_TRANSITION',
      `Cannot ${input.command.toLowerCase()} an incident while it is ${incident.status}.`,
      409,
      { command: input.command, status: incident.status }
    );
  }

  if (input.command === 'RESOLVE') {
    await assertRequiredCustomFieldsPresent(tx, incident.id);
  }

  const updateData = updateDataForCommand(incident, input, now);
  const lifecycleEvent = eventForCommand(input, resolutionNote);

  await tx.incident.update({
    where: { id: incident.id },
    data: {
      ...updateData,
      events: { create: lifecycleEvent },
    },
  });

  // Resolution state, resolution note and timeline metadata are one atomic
  // domain operation. A repeated resolve becomes a no-op before reaching here.
  if (input.command === 'RESOLVE' && resolutionNote && input.actor?.id) {
    await tx.incidentNote.create({
      data: {
        incidentId: incident.id,
        userId: input.actor.id,
        content: `Resolution: ${resolutionNote}`,
      },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: 'COMMENT',
        message: `Resolution note added by ${input.actor.name?.trim() || 'responder'}`,
      },
    });
  }

  return {
    incidentId: incident.id,
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
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_ARGUMENT',
      'A valid incident ID is required.',
      400
    );
  }

  const current = await tx.incident.findUnique({
    where: { id: input.incidentId },
    select: { status: true },
  });

  if (!current) {
    throw new IncidentLifecycleError('INCIDENT_NOT_FOUND', 'Incident not found.', 404);
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
    throw new IncidentLifecycleError(
      'INCIDENT_INVALID_ARGUMENT',
      `Bulk lifecycle operations are limited to ${MAX_BATCH_SIZE} incidents per request.`,
      400,
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
      throw new IncidentLifecycleError(
        'INCIDENT_INVALID_ARGUMENT',
        'Bulk lifecycle operations require valid incident IDs.',
        400
      );
    }

    if (seen.has(incidentId)) {
      throw new IncidentLifecycleError(
        'INCIDENT_INVALID_ARGUMENT',
        'Bulk lifecycle operations cannot contain duplicate incident IDs.',
        400,
        { incidentId }
      );
    }
    seen.add(incidentId);
  }
}

/**
 * Bulk commands are all-or-nothing. Any authorization failure happens before
 * this call; any invalid lifecycle transition rolls back the full batch rather
 * than leaving operators with a partially mutated selection.
 */
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
