import { z } from 'zod/v4';

/**
 * Actions Squire may propose. The model can only ever *propose* one: the proposal is shown to the person
 * as a card describing exactly what will happen, and nothing runs until they confirm it. Execution then goes
 * through the same domain commands and permission checks as the matching button in the application, under
 * the confirming person's own identity.
 *
 * WRITE actions change something when confirmed. NAVIGATE actions only open an existing page (for example a
 * runbook, where the application's own run and approval flow takes over), so Squire never runs automation.
 */
export const SQUIRE_ACTION_NAMES = [
  'acknowledge_incident',
  'resolve_incident',
  'add_incident_note',
  'reassign_incident',
  'link_related_incident',
  'open_runbook',
  'draft_postmortem',
] as const;
export type SquireActionName = (typeof SQUIRE_ACTION_NAMES)[number];

const incidentId = z.string().trim().min(1).max(64);
const userId = z.string().trim().min(1).max(64);

export const SQUIRE_ACTION_INPUTS = {
  acknowledge_incident: z.object({ incidentId }).strict(),
  resolve_incident: z
    .object({ incidentId, resolution: z.string().trim().min(10).max(2_000) })
    .strict(),
  add_incident_note: z
    .object({ incidentId, content: z.string().trim().min(1).max(2_000) })
    .strict(),
  reassign_incident: z.object({ incidentId, assigneeId: userId }).strict(),
  link_related_incident: z
    .object({
      incidentId,
      otherIncidentId: incidentId,
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  open_runbook: z.object({ incidentId, runbookId: z.string().trim().min(1).max(64) }).strict(),
  draft_postmortem: z.object({ incidentId }).strict(),
} satisfies Record<SquireActionName, z.ZodType>;

export type SquireActionInput<N extends SquireActionName> = z.infer<
  (typeof SQUIRE_ACTION_INPUTS)[N]
>;

export const SQUIRE_ACTION_KIND: Record<SquireActionName, 'WRITE' | 'NAVIGATE'> = {
  acknowledge_incident: 'WRITE',
  resolve_incident: 'WRITE',
  add_incident_note: 'WRITE',
  reassign_incident: 'WRITE',
  link_related_incident: 'WRITE',
  open_runbook: 'NAVIGATE',
  draft_postmortem: 'NAVIGATE',
};

/** What the model is told about each action. Every description says the person must confirm it. */
export const SQUIRE_ACTION_DESCRIPTIONS: Record<SquireActionName, string> = {
  acknowledge_incident:
    'Propose acknowledging an open incident. Shown to the user as a card; it happens only if they confirm.',
  resolve_incident:
    'Propose resolving an incident with a resolution note of at least 10 characters describing what fixed it. The user must confirm.',
  add_incident_note:
    'Propose adding a note to an incident timeline (for example a status update or a finding). The user must confirm.',
  reassign_incident:
    'Propose reassigning an incident to a person. Use the person id from who_is_on_call or find_people. The user must confirm.',
  link_related_incident: 'Propose marking two incidents as related. The user must confirm.',
  open_runbook:
    'Offer to open a runbook against this incident. The application then runs its normal run and approval flow.',
  draft_postmortem: 'Offer to open a postmortem draft for this incident.',
};

/** JSON-schema shapes for the model, kept in step with SQUIRE_ACTION_INPUTS by a unit test. */
export const SQUIRE_ACTION_JSON_SCHEMAS: Record<SquireActionName, Record<string, unknown>> = {
  acknowledge_incident: objectSchema({ incidentId: idSchema() }, ['incidentId']),
  resolve_incident: objectSchema(
    { incidentId: idSchema(), resolution: { type: 'string', minLength: 10, maxLength: 2000 } },
    ['incidentId', 'resolution']
  ),
  add_incident_note: objectSchema(
    { incidentId: idSchema(), content: { type: 'string', minLength: 1, maxLength: 2000 } },
    ['incidentId', 'content']
  ),
  reassign_incident: objectSchema({ incidentId: idSchema(), assigneeId: idSchema() }, [
    'incidentId',
    'assigneeId',
  ]),
  link_related_incident: objectSchema(
    {
      incidentId: idSchema(),
      otherIncidentId: idSchema(),
      note: { type: 'string', maxLength: 500 },
    },
    ['incidentId', 'otherIncidentId']
  ),
  open_runbook: objectSchema({ incidentId: idSchema(), runbookId: idSchema() }, [
    'incidentId',
    'runbookId',
  ]),
  draft_postmortem: objectSchema({ incidentId: idSchema() }, ['incidentId']),
};

function idSchema() {
  return { type: 'string', minLength: 1, maxLength: 64 };
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false };
}

export function isSquireActionName(value: string): value is SquireActionName {
  return (SQUIRE_ACTION_NAMES as readonly string[]).includes(value);
}

/** The card the person sees. Every field is plain text; the client never renders it as HTML. */
export interface SquireProposal {
  /** Sealed, single-use and short-lived; the only thing the confirm request sends back. */
  token: string;
  action: SquireActionName;
  kind: 'WRITE' | 'NAVIGATE';
  title: string;
  detail: string;
  incidentId: string;
  expiresAt: string;
}
