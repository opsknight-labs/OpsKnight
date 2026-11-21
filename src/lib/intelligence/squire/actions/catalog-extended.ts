import { z } from 'zod/v4';

/**
 * Extended Squire actions (Workstream F3). Each one is still only a *proposal*: the person sees a card with a
 * server-written preview and nothing happens until they confirm it. Execution goes through the application's
 * own domain commands (escalation service, lifecycle engine, watcher command, Jira integration, status-page
 * announcement routes, runbook engine) with the same capability checks as the matching control in the UI.
 *
 * All of them are opt-in: they are offered, proposed and executed only while the administrator has turned on
 * "Extended assistant actions" (AiSettings.squireExtendedActions, default off).
 *
 * Extension point: `create_suppression_rule` and `create_maintenance_window` belong here once their models
 * land (another workstream owns them). Add the name to EXTENDED_SQUIRE_ACTION_NAMES, an input schema, a
 * description and JSON schema below, a describe case in extended.ts and an execute case in execute.ts that
 * calls that workstream's domain command. Do not write those tables from Squire directly.
 */
export const EXTENDED_SQUIRE_ACTION_NAMES = [
  'escalate_incident',
  'change_urgency',
  'snooze_incident',
  'unlink_related_incident',
  'add_responder',
  'create_jira_issue',
  'draft_status_update',
  'publish_status_update',
  'run_runbook',
] as const;
export type ExtendedSquireActionName = (typeof EXTENDED_SQUIRE_ACTION_NAMES)[number];

/** Actions only the executor itself may propose, as the second step of a two-step flow; never a model tool. */
export const FOLLOW_UP_ONLY_ACTIONS: ReadonlySet<string> = new Set(['publish_status_update']);

/** Bounds for snoozing from the assistant: at least five minutes, at most one day. */
export const SQUIRE_SNOOZE_BOUNDS = { minMinutes: 5, maxMinutes: 24 * 60 } as const;

export const STATUS_UPDATE_TYPES = ['INCIDENT', 'UPDATE', 'WARNING', 'INFO'] as const;

const incidentId = z.string().trim().min(1).max(64);
const entityId = z.string().trim().min(1).max(64);

export const EXTENDED_SQUIRE_ACTION_INPUTS = {
  escalate_incident: z.object({ incidentId }).strict(),
  change_urgency: z.object({ incidentId, urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']) }).strict(),
  snooze_incident: z
    .object({
      incidentId,
      minutes: z
        .number()
        .int()
        .min(SQUIRE_SNOOZE_BOUNDS.minMinutes)
        .max(SQUIRE_SNOOZE_BOUNDS.maxMinutes),
      reason: z.string().trim().max(200).optional(),
    })
    .strict(),
  unlink_related_incident: z
    .object({
      incidentId,
      otherIncidentId: incidentId,
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
  add_responder: z
    .object({
      incidentId,
      userId: entityId,
      role: z.enum(['FOLLOWER', 'STAKEHOLDER', 'EXEC']).default('FOLLOWER'),
    })
    .strict(),
  create_jira_issue: z.object({ incidentId }).strict(),
  draft_status_update: z
    .object({
      incidentId,
      statusPageId: entityId.optional(),
      title: z.string().trim().min(1).max(200),
      message: z.string().trim().min(1).max(5_000),
      type: z.enum(STATUS_UPDATE_TYPES).default('INCIDENT'),
    })
    .strict(),
  publish_status_update: z
    .object({ incidentId, statusPageId: entityId, announcementId: entityId })
    .strict(),
  run_runbook: z.object({ incidentId, runbookId: entityId }).strict(),
} satisfies Record<ExtendedSquireActionName, z.ZodType>;

export const EXTENDED_SQUIRE_ACTION_KIND: Record<ExtendedSquireActionName, 'WRITE'> = {
  escalate_incident: 'WRITE',
  change_urgency: 'WRITE',
  snooze_incident: 'WRITE',
  unlink_related_incident: 'WRITE',
  add_responder: 'WRITE',
  create_jira_issue: 'WRITE',
  draft_status_update: 'WRITE',
  publish_status_update: 'WRITE',
  run_runbook: 'WRITE',
};

export const EXTENDED_SQUIRE_ACTION_DESCRIPTIONS: Record<ExtendedSquireActionName, string> = {
  escalate_incident:
    'Propose paging the next escalation level of an OPEN incident now. Only when the current responders are not responding. The user must confirm.',
  change_urgency:
    'Propose changing an incident urgency to LOW, MEDIUM or HIGH. The user must confirm.',
  snooze_incident: `Propose snoozing an incident for ${SQUIRE_SNOOZE_BOUNDS.minMinutes}-${SQUIRE_SNOOZE_BOUNDS.maxMinutes} minutes with an optional reason. Notifications pause until then. The user must confirm.`,
  unlink_related_incident:
    'Propose removing a related-incident link that was accepted earlier. The user must confirm.',
  add_responder:
    'Propose adding a person to an incident as a FOLLOWER, STAKEHOLDER or EXEC watcher. Use the person id from who_is_on_call or find_people. The user must confirm.',
  create_jira_issue:
    "Propose creating a Jira issue for an incident through the workspace's Jira integration, when it is configured for the service. The user must confirm.",
  draft_status_update:
    'Propose an unpublished status-page draft (title and customer-facing message) about an incident. Publishing is a separate confirmation. The user must confirm.',
  publish_status_update: 'Publishes a status-page draft. Only offered after a draft was created.',
  run_runbook:
    "Propose running a runbook bound to the incident's service. The runbook's own approval steps still apply. The user must confirm.",
};

const idSchema = () => ({ type: 'string', minLength: 1, maxLength: 64 });
const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const EXTENDED_SQUIRE_ACTION_JSON_SCHEMAS: Record<
  ExtendedSquireActionName,
  Record<string, unknown>
> = {
  escalate_incident: objectSchema({ incidentId: idSchema() }, ['incidentId']),
  change_urgency: objectSchema(
    { incidentId: idSchema(), urgency: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] } },
    ['incidentId', 'urgency']
  ),
  snooze_incident: objectSchema(
    {
      incidentId: idSchema(),
      minutes: {
        type: 'integer',
        minimum: SQUIRE_SNOOZE_BOUNDS.minMinutes,
        maximum: SQUIRE_SNOOZE_BOUNDS.maxMinutes,
      },
      reason: { type: 'string', maxLength: 200 },
    },
    ['incidentId', 'minutes']
  ),
  unlink_related_incident: objectSchema(
    {
      incidentId: idSchema(),
      otherIncidentId: idSchema(),
      note: { type: 'string', maxLength: 500 },
    },
    ['incidentId', 'otherIncidentId']
  ),
  add_responder: objectSchema(
    {
      incidentId: idSchema(),
      userId: idSchema(),
      role: { type: 'string', enum: ['FOLLOWER', 'STAKEHOLDER', 'EXEC'] },
    },
    ['incidentId', 'userId']
  ),
  create_jira_issue: objectSchema({ incidentId: idSchema() }, ['incidentId']),
  draft_status_update: objectSchema(
    {
      incidentId: idSchema(),
      statusPageId: idSchema(),
      title: { type: 'string', minLength: 1, maxLength: 200 },
      message: { type: 'string', minLength: 1, maxLength: 5000 },
      type: { type: 'string', enum: [...STATUS_UPDATE_TYPES] },
    },
    ['incidentId', 'title', 'message']
  ),
  publish_status_update: objectSchema(
    { incidentId: idSchema(), statusPageId: idSchema(), announcementId: idSchema() },
    ['incidentId', 'statusPageId', 'announcementId']
  ),
  run_runbook: objectSchema({ incidentId: idSchema(), runbookId: idSchema() }, [
    'incidentId',
    'runbookId',
  ]),
};

export function isExtendedSquireAction(value: string): value is ExtendedSquireActionName {
  return (EXTENDED_SQUIRE_ACTION_NAMES as readonly string[]).includes(value);
}
