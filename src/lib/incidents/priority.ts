import type { IncidentUrgency } from '@prisma/client';

export const INCIDENT_PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
export type IncidentPriority = (typeof INCIDENT_PRIORITIES)[number];

export function isIncidentPriority(value: unknown): value is IncidentPriority {
  return typeof value === 'string' && (INCIDENT_PRIORITIES as readonly string[]).includes(value);
}

export const INCIDENT_PRIORITY_DEFINITIONS: Record<
  IncidentPriority,
  { label: string; description: string }
> = {
  P1: { label: 'Crisis', description: 'Critical business impact requiring immediate response.' },
  P2: { label: 'High', description: 'Major impact requiring rapid coordinated response.' },
  P3: { label: 'Medium', description: 'Material impact handled through the normal response path.' },
  P4: { label: 'Low', description: 'Limited impact with a lower response obligation.' },
  P5: {
    label: 'Informational',
    description: 'Minimal impact tracked for visibility and follow-up.',
  },
};

export const INCIDENT_URGENCY_DEFINITIONS: Record<
  IncidentUrgency,
  { label: string; description: string }
> = {
  HIGH: {
    label: 'High',
    description: 'Disruptive notification that may bypass normal quiet-hour behavior.',
  },
  MEDIUM: { label: 'Medium', description: 'Normal responder paging and notification behavior.' },
  LOW: { label: 'Low', description: 'Non-disruptive, quiet-hours-aware notification behavior.' },
};

export function getIncidentPriorityDefinition(priority: IncidentPriority) {
  switch (priority) {
    case 'P1':
      return INCIDENT_PRIORITY_DEFINITIONS.P1;
    case 'P2':
      return INCIDENT_PRIORITY_DEFINITIONS.P2;
    case 'P3':
      return INCIDENT_PRIORITY_DEFINITIONS.P3;
    case 'P4':
      return INCIDENT_PRIORITY_DEFINITIONS.P4;
    case 'P5':
      return INCIDENT_PRIORITY_DEFINITIONS.P5;
  }
}

export function normalizeIncidentPriority(
  value: string | null | undefined
): IncidentPriority | null {
  const match = value
    ?.trim()
    .toUpperCase()
    .match(/^P?([1-5])$/);
  return match ? (`P${match[1]}` as IncidentPriority) : null;
}
