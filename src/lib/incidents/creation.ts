import 'server-only';

import type { IncidentUrgency, IncidentVisibility, Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { AppError } from '@/lib/errors';
import { validateCustomFieldValue } from '@/lib/custom-fields';
import { IncidentCreateSchema } from '@/lib/validation';
import { enqueueIncidentCreationSideEffects } from '@/lib/event-outbox';
import { initializeEscalationExecution } from '@/lib/escalation/repository';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';

export const INCIDENT_CREATION_OUTCOMES = ['CREATED', 'MERGED', 'REOPENED'] as const;
export type IncidentCreationOutcome = (typeof INCIDENT_CREATION_OUTCOMES)[number];
export type IncidentCreationSource = 'WEB' | 'MOBILE' | 'REST_API';

export type IncidentCreationActor = {
  id?: string;
  name?: string;
};

export type IncidentCreationCustomFieldInput = {
  fieldId: string;
  value: string;
};

export interface IncidentCreationInput {
  title: string;
  description?: string | null;
  serviceId: string;
  urgency: IncidentUrgency;
  priority?: string | null;
  dedupKey?: string | null;
  assigneeId?: string | null;
  teamId?: string | null;
  visibility?: IncidentVisibility;
  customFields?: readonly IncidentCreationCustomFieldInput[];
  source: IncidentCreationSource;
  actor?: IncidentCreationActor;
  /** Test seam. Production callers should use the server clock. */
  now?: Date;
}

export interface IncidentCreationResult {
  id: string;
  outcome: IncidentCreationOutcome;
}

const MAX_DEDUP_KEY_LENGTH = 200;
const MAX_ID_LENGTH = 100;
const REOPEN_WINDOW_MS = 30 * 60 * 1000;

function invalidArgument(
  userMessage: string,
  field?: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError({
    code: 'INCIDENT_INVALID_ARGUMENT',
    userMessage,
    fields: field ? [{ field, code: 'invalid', message: userMessage }] : undefined,
    details,
  });
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function assertId(value: string | null, field: string): void {
  if (value !== null && (value.length === 0 || value.length > MAX_ID_LENGTH)) {
    throw invalidArgument(`A valid ${field} is required.`, field);
  }
}

function normalizeInput(input: IncidentCreationInput): IncidentCreationInput {
  const parsed = IncidentCreateSchema.safeParse({
    title: input.title,
    description: input.description ?? null,
    serviceId: input.serviceId,
    urgency: input.urgency,
    priority: input.priority ?? null,
  });

  if (!parsed.success) {
    throw new AppError({
      code: 'INCIDENT_INVALID_ARGUMENT',
      userMessage: 'Please check your incident details and try again.',
      fields: parsed.error.issues.map(issue => ({
        field: issue.path.join('.') || 'incident',
        code: issue.code,
        message: issue.message,
      })),
      details: { issues: parsed.error.issues },
    });
  }

  const dedupKey = normalizeOptional(input.dedupKey);
  const assigneeId = normalizeOptional(input.assigneeId);
  const teamId = normalizeOptional(input.teamId);

  if (dedupKey && dedupKey.length > MAX_DEDUP_KEY_LENGTH) {
    throw invalidArgument(
      `Deduplication key must be ${MAX_DEDUP_KEY_LENGTH} characters or fewer.`,
      'dedupKey'
    );
  }
  assertId(assigneeId, 'assigneeId');
  assertId(teamId, 'teamId');

  if (assigneeId && teamId) {
    throw invalidArgument('Assign an incident to either a user or a team, not both.', 'assigneeId');
  }

  if (input.now !== undefined && !Number.isFinite(input.now.getTime())) {
    throw invalidArgument('Incident creation time is invalid.');
  }

  return {
    ...input,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    serviceId: parsed.data.serviceId,
    urgency: parsed.data.urgency,
    priority: normalizeOptional(parsed.data.priority),
    dedupKey,
    assigneeId,
    teamId,
    visibility: input.visibility,
  };
}

async function validateCustomFields(
  tx: Prisma.TransactionClient,
  supplied: readonly IncidentCreationCustomFieldInput[] | undefined
): Promise<Array<{ fieldId: string; value: string }>> {
  const suppliedMap = new Map<string, string>();
  for (const entry of supplied ?? []) {
    const fieldId = entry.fieldId?.trim();
    if (!fieldId || fieldId.length > MAX_ID_LENGTH) {
      throw invalidArgument('One or more custom fields are invalid.', 'customFields');
    }
    suppliedMap.set(fieldId, entry.value);
  }

  const fields = await tx.customField.findMany({ orderBy: { order: 'asc' } });
  const knownIds = new Set(fields.map(field => field.id));
  const invalidIds = [...suppliedMap.keys()].filter(fieldId => !knownIds.has(fieldId));
  if (invalidIds.length > 0) {
    throw invalidArgument(
      'One or more custom fields are invalid. Refresh the form and try again.',
      'customFields',
      { invalidCustomFieldIds: invalidIds }
    );
  }

  return fields.flatMap(field => {
    const value = suppliedMap.has(field.id) ? suppliedMap.get(field.id) : field.defaultValue;
    const validation = validateCustomFieldValue(field, value);
    if (!validation.valid) {
      const userMessage = validation.error || `Invalid ${field.name}`;
      throw invalidArgument(userMessage, `customField_${field.id}`, { fieldId: field.id });
    }

    return validation.normalizedValue === null
      ? []
      : [{ fieldId: field.id, value: validation.normalizedValue }];
  });
}

async function assertServiceExists(
  tx: Prisma.TransactionClient,
  serviceId: string
): Promise<{ id: string; defaultIncidentVisibility: IncidentVisibility }> {
  const service = await tx.service.findUnique({
    where: { id: serviceId },
    select: { id: true, defaultIncidentVisibility: true },
  });
  if (!service) {
    throw new AppError({
      code: 'SERVICE_NOT_FOUND',
      userMessage: 'The selected service could not be found.',
      details: { serviceId },
    });
  }
  return service;
}

async function validateAssignmentReferences(
  tx: Prisma.TransactionClient,
  input: IncidentCreationInput
): Promise<{ assigneeName: string | null; teamName: string | null }> {
  let assigneeName: string | null = null;
  if (input.assigneeId) {
    const assignee = await tx.user.findUnique({
      where: { id: input.assigneeId },
      select: { name: true, status: true },
    });
    if (!assignee || assignee.status !== 'ACTIVE') {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'The selected assignee is no longer available.',
        details: { resource: 'user', userId: input.assigneeId },
      });
    }
    assigneeName = assignee.name;
  }

  let teamName: string | null = null;
  if (input.teamId) {
    const team = await tx.team.findUnique({
      where: { id: input.teamId },
      select: { name: true },
    });
    if (!team) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'The selected team could not be found.',
        details: { resource: 'team', teamId: input.teamId },
      });
    }
    teamName = team.name;
  }

  return { assigneeName, teamName };
}

function creationMessage(
  input: IncidentCreationInput,
  assigneeName: string | null,
  teamName: string | null
): string {
  const source = input.source === 'REST_API' ? ' via REST API' : '';
  if (input.assigneeId) {
    return `Incident created${source} with ${input.urgency} urgency and assigned to ${assigneeName || 'user'}`;
  }
  if (input.teamId) {
    return `Incident created${source} with ${input.urgency} urgency and assigned to ${teamName || 'team'}`;
  }
  return `Incident created${source} with ${input.urgency} urgency`;
}

export async function applyIncidentCreation(
  tx: Prisma.TransactionClient,
  rawInput: IncidentCreationInput
): Promise<IncidentCreationResult> {
  const input = normalizeInput(rawInput);
  const now = input.now ?? new Date();

  const service = await assertServiceExists(tx, input.serviceId);
  const resolvedVisibility = input.visibility ?? service.defaultIncidentVisibility ?? 'PUBLIC';

  // The current REST contract does not expose custom fields. Preserve that wire
  // behavior while web/mobile continue to validate required/default field values.
  const customFieldEntries =
    input.source === 'REST_API' && input.customFields === undefined
      ? []
      : await validateCustomFields(tx, input.customFields);

  if (input.dedupKey) {
    const existing = await tx.incident.findFirst({
      where: {
        dedupKey: input.dedupKey,
        serviceId: input.serviceId,
        status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await tx.incidentNote.create({
        data: {
          incidentId: existing.id,
          userId: input.actor?.id ?? null,
          content: `[Manual Report Merged] User reported recurrence.\n\nTitle: ${input.title}\nDescription: ${input.description ?? ''}`,
        },
      });
      await tx.incidentEvent.create({
        data: {
          incidentId: existing.id,
          type: 'COMMENT',
          message: 'Manual report merged from user.',
        },
      });
      return { id: existing.id, outcome: 'MERGED' };
    }

    const recentResolved = await tx.incident.findFirst({
      where: {
        dedupKey: input.dedupKey,
        serviceId: input.serviceId,
        status: 'RESOLVED',
        resolvedAt: { gt: new Date(now.getTime() - REOPEN_WINDOW_MS) },
      },
      orderBy: { resolvedAt: 'desc' },
    });

    if (recentResolved) {
      await applyIncidentLifecycleCommand(tx, {
        incidentId: recentResolved.id,
        command: 'REOPEN',
        source: input.source,
        actor: input.actor,
        expectedStatus: 'RESOLVED',
        eventMessage: `Incident re-opened due to manual report within 30m window.\nSummary: ${input.title}`,
        now,
      });

      await tx.incidentNote.create({
        data: {
          incidentId: recentResolved.id,
          userId: input.actor?.id ?? null,
          content: `[Re-opened] User reported recurrence.\n\nTitle: ${input.title}\nDescription: ${input.description ?? ''}`,
        },
      });

      return { id: recentResolved.id, outcome: 'REOPENED' };
    }
  }

  const { assigneeName, teamName } = await validateAssignmentReferences(tx, input);

  const incident = await tx.incident.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      status: 'OPEN',
      urgency: input.urgency,
      serviceId: input.serviceId,
      visibility: resolvedVisibility,
      priority: input.priority ?? null,
      dedupKey: input.dedupKey ?? null,
      assigneeId: input.assigneeId ?? null,
      teamId: input.assigneeId ? null : (input.teamId ?? null),
      events: {
        create: {
          type: 'LEGACY_OTHER',
          message: creationMessage(input, assigneeName, teamName),
        },
      },
      ...(customFieldEntries.length > 0
        ? {
            customFieldValues: {
              create: customFieldEntries.map(entry => ({
                customFieldId: entry.fieldId,
                value: entry.value,
              })),
            },
          }
        : {}),
    },
    select: { id: true },
  });

  // Escalation state and its first due job commit with the incident, so an
  // OPEN incident with a policy is never left with nothing scheduled.
  await initializeEscalationExecution(tx, {
    incidentId: incident.id,
    serviceId: input.serviceId,
    now,
  });

  await enqueueIncidentCreationSideEffects(tx, {
    incidentId: incident.id,
    source: input.source,
  });

  return { id: incident.id, outcome: 'CREATED' };
}

export async function executeIncidentCreation(
  input: IncidentCreationInput
): Promise<IncidentCreationResult> {
  return runSerializableTransaction(tx => applyIncidentCreation(tx, input));
}
