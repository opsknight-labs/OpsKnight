import 'server-only';

import type { Prisma } from '@prisma/client';
import {
  readIncidentResponseContext,
  type IncidentResponseContext,
  type ResponseContextReadResult,
} from '@/lib/automation/response-context';
import { isAutomationConditionField, type AutomationContextField } from './automation-binding';
import type { TriggerAutomationContext } from './matcher';

export type ResponseContextUnavailableReason = Extract<
  ResponseContextReadResult,
  { status: 'UNAVAILABLE' }
>['reason'];

export type RunbookTriggerContext = {
  incident: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    urgency: string;
    priority: string | null;
    tags: string[];
  };
  service: { id: string; name: string; teamId: string | null };
  automation: TriggerAutomationContext & {
    reason: ResponseContextUnavailableReason | null;
    versionNumber: number | null;
  };
};

export type LoadedRunbookIncidentContext = {
  trigger: RunbookTriggerContext;
  responseContext: IncidentResponseContext | null;
};

export function conditionsReferenceAutomation(
  conditions: ReadonlyArray<{ field: string }>
): boolean {
  return conditions.some(condition => isAutomationConditionField(condition.field));
}

/** Typed fields of a verified context, or null when the context is unavailable. */
export function automationContextFields(
  context: IncidentResponseContext | null
): AutomationContextField[] | null {
  return context
    ? context.fields.map(field => ({
        key: field.key,
        type: field.type,
        state: field.state,
        value: field.state === 'RECOGNIZED' ? field.value : null,
      }))
    : null;
}

/**
 * The single loader for incident trigger context. Trigger evaluation and the AUTOMATIC
 * re-validation in prepareRunbookExecution must both use it so they see identical data.
 */
export async function loadRunbookIncidentContext(
  client: Pick<Prisma.TransactionClient, 'incident' | 'incidentAutomationDecision'>,
  incidentId: string
): Promise<LoadedRunbookIncidentContext | null> {
  const incident = await client.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      urgency: true,
      priority: true,
      tags: { select: { tag: { select: { name: true } } } },
      service: { select: { id: true, name: true, teamId: true } },
    },
  });
  if (!incident) return null;
  const read = await readIncidentResponseContext(client, incidentId);
  const responseContext = read.status === 'AVAILABLE' ? read.context : null;
  return {
    trigger: {
      incident: {
        id: incident.id,
        title: incident.title,
        description: incident.description,
        status: incident.status,
        urgency: incident.urgency,
        priority: incident.priority,
        tags: incident.tags.map(item => item.tag.name),
      },
      service: incident.service,
      automation: {
        available: read.status === 'AVAILABLE',
        reason: read.status === 'UNAVAILABLE' ? read.reason : null,
        versionNumber: responseContext?.versionNumber ?? null,
        fields: automationContextFields(responseContext),
      },
    },
    responseContext,
  };
}
