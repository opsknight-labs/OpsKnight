import { z } from 'zod/v3';

export const DESTINATION_PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
export const DESTINATION_URGENCIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

export const destinationPrioritiesSchema = z.array(z.enum(DESTINATION_PRIORITIES)).max(5);
export const destinationUrgenciesSchema = z.array(z.enum(DESTINATION_URGENCIES)).max(3);

/** Empty list = match all. Decides only whether a NEW card may be posted; existing cards always edit. */
export function slackDestinationMatches(
  conditions: { priorities?: readonly string[] | null; urgencies?: readonly string[] | null },
  incident: { priority?: string | null; urgency?: string | null }
): boolean {
  const { priorities, urgencies } = conditions;
  if (priorities?.length && !(incident.priority && priorities.includes(incident.priority)))
    return false;
  if (urgencies?.length && !(incident.urgency && urgencies.includes(incident.urgency)))
    return false;
  return true;
}
