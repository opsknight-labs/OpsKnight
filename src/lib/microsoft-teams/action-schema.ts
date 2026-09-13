import { z } from 'zod';

export const TEAMS_CHATOPS_VERBS = {
  REFRESH: 'opsknight.incident.refresh',
  ACK: 'opsknight.incident.ack',
  RESOLVE: 'opsknight.incident.resolve',
  ASSIGN_SELF: 'opsknight.incident.assign-self',
  NOTE: 'opsknight.incident.note',
  PRIORITY: 'opsknight.incident.priority',
  SNOOZE: 'opsknight.incident.snooze',
  ESCALATE: 'opsknight.incident.escalate',
  JOIN_RESPONDER: 'opsknight.incident.join-responder',
  WHO: 'opsknight.incident.who',
} as const;

export type TeamsChatOpsVerb = (typeof TEAMS_CHATOPS_VERBS)[keyof typeof TEAMS_CHATOPS_VERBS];

const context = z.object({
  v: z.literal(2),
  incidentId: z.string().trim().min(1).max(191),
  destinationId: z.string().trim().min(1).max(191),
  messageGeneration: z.coerce.number().int().positive(),
}).strict();

const schemas = {
  [TEAMS_CHATOPS_VERBS.REFRESH]: context,
  [TEAMS_CHATOPS_VERBS.ACK]: context,
  [TEAMS_CHATOPS_VERBS.RESOLVE]: context.extend({ resolutionNote: z.string().trim().min(1).max(2000).optional() }).strict(),
  [TEAMS_CHATOPS_VERBS.ASSIGN_SELF]: context,
  [TEAMS_CHATOPS_VERBS.NOTE]: context.extend({ note: z.string().trim().min(1).max(2000) }).strict(),
  [TEAMS_CHATOPS_VERBS.PRIORITY]: context.extend({ priority: z.string().trim().regex(/^P[1-5]$/) }).strict(),
  [TEAMS_CHATOPS_VERBS.SNOOZE]: context.extend({ minutes: z.coerce.number().int().min(1).max(10080), reason: z.string().trim().max(500).optional() }).strict(),
  [TEAMS_CHATOPS_VERBS.ESCALATE]: context,
  [TEAMS_CHATOPS_VERBS.JOIN_RESPONDER]: context,
  [TEAMS_CHATOPS_VERBS.WHO]: context,
} satisfies Record<TeamsChatOpsVerb, z.ZodType>;

const envelope = z.object({
  action: z.object({
    type: z.literal('Action.Execute'),
    id: z.string().max(256).optional(),
    verb: z.enum(Object.values(TEAMS_CHATOPS_VERBS) as [TeamsChatOpsVerb, ...TeamsChatOpsVerb[]]),
    data: z.unknown(),
  }).strict(),
  trigger: z.enum(['manual', 'automatic']).optional(),
}).strict();

export function parseMicrosoftTeamsAction(value: unknown) {
  const parsed = envelope.parse(value);
  return { ...parsed, data: schemas[parsed.action.verb].parse(parsed.action.data) };
}
