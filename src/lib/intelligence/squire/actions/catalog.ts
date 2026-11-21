import { z } from 'zod/v4';
import {
  EXTENDED_SQUIRE_ACTION_DESCRIPTIONS,
  EXTENDED_SQUIRE_ACTION_INPUTS,
  EXTENDED_SQUIRE_ACTION_JSON_SCHEMAS,
  EXTENDED_SQUIRE_ACTION_KIND,
  EXTENDED_SQUIRE_ACTION_NAMES,
} from './catalog-extended';

/**
 * Actions Squire may propose. The model can only ever *propose* one: the proposal is shown to the person
 * as a card describing exactly what will happen, and nothing runs until they confirm it. Execution then goes
 * through the same domain commands and permission checks as the matching button in the application, under
 * the confirming person's own identity.
 *
 * WRITE actions change something when confirmed. NAVIGATE actions only open an existing page (for example a
 * runbook, where the application's own run and approval flow takes over), so Squire never runs automation.
 * The one automation action, `draft_automation_rule`, is NAVIGATE too: it opens the automation workspace with
 * a rule pre-filled, which joins the draft only when the person adds it and is never published from Squire.
 */
export const SQUIRE_ACTION_NAMES = [
  'acknowledge_incident',
  'resolve_incident',
  'add_incident_note',
  'reassign_incident',
  'link_related_incident',
  'open_runbook',
  'draft_postmortem',
  'draft_automation_rule',
  // Extended actions (opt-in, catalog-extended.ts).
  ...EXTENDED_SQUIRE_ACTION_NAMES,
  // Knowledge memory (F4): a durable fact about the incident's service, saved only after confirmation.
  'learn_service_fact',
] as const;
export type SquireActionName = (typeof SQUIRE_ACTION_NAMES)[number];

const incidentId = z.string().trim().min(1).max(64);
const AUTOMATION_RULE_OPERATORS = [
  'EQ',
  'NE',
  'IN',
  'NOT_IN',
  'LT',
  'LTE',
  'GT',
  'GTE',
  'IS_SET',
  'IS_MISSING',
] as const;
const automationValue = z.union([z.string().max(256), z.number(), z.boolean()]);
const userId = z.string().trim().min(1).max(64);

export const SQUIRE_ACTION_INPUTS = {
  acknowledge_incident: z.object({ incidentId }).strict(),
  resolve_incident: z
    .object({ incidentId, resolution: z.string().trim().min(10).max(1_000) })
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
  draft_automation_rule: z
    .object({
      incidentId,
      name: z.string().trim().min(1).max(100).optional(),
      conditions: z
        .array(
          z
            .object({
              fieldKey: z.string().trim().min(1).max(64),
              operator: z.enum(AUTOMATION_RULE_OPERATORS),
              value: z.union([automationValue, z.array(automationValue).max(50)]).optional(),
            })
            .strict()
        )
        .min(1)
        .max(5),
      priority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']).optional(),
      policyId: z.string().trim().min(1).max(64).optional(),
      noEscalation: z.literal(true).optional(),
    })
    .strict(),
  ...EXTENDED_SQUIRE_ACTION_INPUTS,
  learn_service_fact: z.object({ incidentId, fact: z.string().trim().min(10).max(500) }).strict(),
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
  draft_automation_rule: 'NAVIGATE',
  ...EXTENDED_SQUIRE_ACTION_KIND,
  learn_service_fact: 'WRITE',
};

/**
 * WRITE actions whose confirmation re-checks everything inside their own domain command instead of comparing an
 * incident snapshot: adding a note or a fact does not depend on the incident's status or assignment.
 */
export const SNAPSHOT_FREE_ACTIONS: ReadonlySet<SquireActionName> = new Set([
  'add_incident_note',
  'learn_service_fact',
]);

/**
 * WRITE actions that have a chat confirmation path (Slack and Teams buttons, `runFromChat`). Every other
 * WRITE action needs the web session: chat renders it as an "Open in OpsKnight" link, and the executor
 * refuses a chat confirmation of it before the single-use receipt is written, so the card stays usable.
 */
export const CHAT_CONFIRMABLE_ACTIONS: ReadonlySet<SquireActionName> = new Set([
  'acknowledge_incident',
  'resolve_incident',
  'add_incident_note',
  'reassign_incident',
  'link_related_incident',
]);

export function isChatConfirmableAction(action: string): boolean {
  return (CHAT_CONFIRMABLE_ACTIONS as ReadonlySet<string>).has(action);
}

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
  draft_automation_rule:
    "Offer a new automation rule for this incident's service, written from what the user asked for: conditions on automation fields (severity, source, integration, urgency, priority or the service's own context fields) and exactly one outcome: a priority, an escalation policy id, or noEscalation. It opens the automation editor with the rule pre-filled; nothing is saved until the user adds it to the draft, and it is never published from here.",
  ...EXTENDED_SQUIRE_ACTION_DESCRIPTIONS,
  learn_service_fact:
    'Propose remembering one durable, non-secret fact about the service of this incident (for example how it fails over or what usually fixes it), learned from this investigation. It is saved to Squire’s knowledge only if the user confirms, and only people who manage the service can confirm.',
};

/** JSON-schema shapes for the model, kept in step with SQUIRE_ACTION_INPUTS by a unit test. */
export const SQUIRE_ACTION_JSON_SCHEMAS: Record<SquireActionName, Record<string, unknown>> = {
  acknowledge_incident: objectSchema({ incidentId: idSchema() }, ['incidentId']),
  resolve_incident: objectSchema(
    { incidentId: idSchema(), resolution: { type: 'string', minLength: 10, maxLength: 1000 } },
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
  draft_automation_rule: objectSchema(
    {
      incidentId: idSchema(),
      name: { type: 'string', minLength: 1, maxLength: 100 },
      conditions: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: objectSchema(
          {
            fieldKey: { type: 'string', minLength: 1, maxLength: 64 },
            operator: { type: 'string', enum: [...AUTOMATION_RULE_OPERATORS] },
            value: {
              anyOf: [
                { type: 'string', maxLength: 256 },
                { type: 'number' },
                { type: 'boolean' },
                {
                  type: 'array',
                  maxItems: 50,
                  items: {
                    anyOf: [
                      { type: 'string', maxLength: 256 },
                      { type: 'number' },
                      { type: 'boolean' },
                    ],
                  },
                },
              ],
            },
          },
          ['fieldKey', 'operator']
        ),
      },
      priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'] },
      policyId: idSchema(),
      noEscalation: { type: 'boolean', const: true },
    },
    ['incidentId', 'conditions']
  ),
  ...EXTENDED_SQUIRE_ACTION_JSON_SCHEMAS,
  learn_service_fact: objectSchema(
    { incidentId: idSchema(), fact: { type: 'string', minLength: 10, maxLength: 500 } },
    ['incidentId', 'fact']
  ),
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
  /** Opaque identifier for owner-only, read-only outcome lookup; never authorizes a mutation. */
  receiptId?: string;
  action: SquireActionName;
  kind: 'WRITE' | 'NAVIGATE';
  title: string;
  detail: string;
  incidentId: string;
  expiresAt: string;
  /** The turn read third-party text (alerts, notes, payloads) before proposing this. */
  untrustedContext?: boolean;
  /** Server-written facts shown on the card before confirming (extended actions). Plain text only. */
  preview?: Array<{ label: string; value: string }>;
  /** Server-chosen confirm button text, for example "Escalate" or "Publish". */
  confirmLabel?: string;
  /** The change reaches people or systems outside this incident (paging, Jira, a public page, automation). */
  impact?: 'PAGES_PEOPLE' | 'EXTERNAL_SYSTEM' | 'PUBLIC' | 'AUTOMATION';
  /** Step marker for two-step flows, for example "Step 1 of 2". */
  step?: string;
}
