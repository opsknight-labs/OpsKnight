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

const context = z
  .object({
    v: z.literal(2),
    incidentId: z.string().trim().min(1).max(191),
    destinationId: z.string().trim().min(1).max(191),
    messageGeneration: z.coerce.number().int().positive(),
    warRoomId: z.string().trim().min(1).max(191).optional(),
  })
  .strict();

const schemas = {
  [TEAMS_CHATOPS_VERBS.REFRESH]: context,
  [TEAMS_CHATOPS_VERBS.ACK]: context,
  [TEAMS_CHATOPS_VERBS.RESOLVE]: context
    .extend({
      // Absent or blank/whitespace → undefined (genuinely optional).
      // If provided must meet domain bounds (10–1000 chars) to match lifecycle.ts.
      resolutionNote: z.preprocess(
        v => (typeof v === 'string' ? v.trim() || undefined : v === undefined ? undefined : v),
        z
          .string()
          .min(10, 'Resolution note must be at least 10 characters.')
          .max(1000, 'Resolution note must be at most 1000 characters.')
          .optional()
      ),
    })
    .strict(),
  [TEAMS_CHATOPS_VERBS.ASSIGN_SELF]: context,
  [TEAMS_CHATOPS_VERBS.NOTE]: context.extend({ note: z.string().trim().min(1).max(2000) }).strict(),
  [TEAMS_CHATOPS_VERBS.PRIORITY]: context
    .extend({
      priority: z
        .string()
        .trim()
        .regex(/^P[1-5]$/),
    })
    .strict(),
  [TEAMS_CHATOPS_VERBS.SNOOZE]: context
    .extend({
      minutes: z.coerce.number().int().min(1).max(10080),
      reason: z.string().trim().max(500).optional(),
    })
    .strict(),
  [TEAMS_CHATOPS_VERBS.ESCALATE]: context,
  [TEAMS_CHATOPS_VERBS.JOIN_RESPONDER]: context,
  [TEAMS_CHATOPS_VERBS.WHO]: context,
} satisfies Record<TeamsChatOpsVerb, z.ZodType>;

const envelope = z
  .object({
    action: z
      .object({
        type: z.literal('Action.Execute'),
        id: z.string().max(256).nullable().optional(),
        verb: z.enum(
          Object.values(TEAMS_CHATOPS_VERBS) as [TeamsChatOpsVerb, ...TeamsChatOpsVerb[]]
        ),
        data: z.unknown(),
        title: z.string().nullable().optional(),
        associatedInputs: z.string().nullable().optional(),
      })
      .passthrough(),
    trigger: z.string().optional(),
    state: z.string().optional(),
    inputs: z.record(z.unknown()).optional(),
  })
  .passthrough();

export function parseMicrosoftTeamsAction(value: unknown) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {}
  }
  const parsed = envelope.parse(value);
  let rawData = parsed.action.data;
  if (typeof rawData === 'string') {
    try {
      rawData = JSON.parse(rawData);
    } catch {}
  }
  if (
    parsed.inputs &&
    typeof parsed.inputs === 'object' &&
    typeof rawData === 'object' &&
    rawData !== null
  ) {
    rawData = { ...parsed.inputs, ...rawData };
  }
  return { ...parsed, data: schemas[parsed.action.verb].parse(rawData) };
}
