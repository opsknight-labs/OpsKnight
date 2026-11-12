import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { dashboardUserReadWhere, runbookReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { authorizeIncidentEscalation } from '@/lib/escalation/authorization';
import { getJiraCapabilities } from '@/lib/jira-capabilities';
import { flattenSteps, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { getAiSettings } from '../../ai/settings';
import { readIncidentForActor } from '../deterministic';
import {
  EXTENDED_SQUIRE_ACTION_INPUTS,
  FOLLOW_UP_ONLY_ACTIONS,
  type ExtendedSquireActionName,
} from './catalog-extended';
import type { SquireProposal } from './catalog';

/**
 * Read-only helpers for the extended Squire actions: the card text (fixed server templates), the
 * situation snapshot sealed into a proposal, and the re-check of that snapshot inside the executor's
 * serializable transaction. Nothing here writes; execution lives in execute.ts.
 */

type Client = Prisma.TransactionClient | typeof prisma;
type Snapshot = Record<string, string | number | boolean | null>;
type Input<N extends ExtendedSquireActionName> = ReturnType<
  (typeof EXTENDED_SQUIRE_ACTION_INPUTS)[N]['parse']
>;

export interface ExtendedDescription {
  title: string;
  detail: string;
  href?: string;
  preview?: Array<{ label: string; value: string }>;
  confirmLabel?: string;
  impact?: SquireProposal['impact'];
  step?: string;
}

const short = (text: string, max = 120) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const quoted = (text: string, max = 80) => `“${short(text, max)}”`;
const can = (
  actor: AuthorizationActor,
  capability: (typeof CAPABILITIES)[keyof typeof CAPABILITIES]
) => actor.status === 'ACTIVE' && hasCapability(actor.role, capability);

/** Extended actions are opt-in for the whole workspace and never available to API keys. */
export async function extendedActionsAvailable(
  actor: AuthorizationActor,
  name: ExtendedSquireActionName,
  options: { followUp?: boolean } = {}
): Promise<boolean> {
  if (actor.apiKey || actor.status !== 'ACTIVE') return false;
  if (FOLLOW_UP_ONLY_ACTIONS.has(name) && !options.followUp) return false;
  return (await getAiSettings()).squireExtendedActions;
}

function minutesLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}

function utcClock(date: Date): string {
  return `${date.toISOString().slice(11, 16)} UTC`;
}

const TARGET_LABEL: Record<string, string> = {
  USER: 'person',
  TEAM: 'team',
  SCHEDULE: 'on-call schedule',
};

/** The card for an extended action, or null when this person cannot do it here and now. */
export async function describeExtended(
  actor: AuthorizationActor,
  name: ExtendedSquireActionName,
  input: Record<string, unknown>,
  incident: { id: string; title: string; status: string; urgency?: string },
  now: Date = new Date()
): Promise<ExtendedDescription | null> {
  const subject = quoted(incident.title);
  switch (name) {
    case 'escalate_incident': {
      if (incident.status !== 'OPEN') return null;
      try {
        await authorizeIncidentEscalation({ actorId: actor.id, incidentId: incident.id });
      } catch {
        return null;
      }
      const row = await prisma.incident.findUnique({
        where: { id: incident.id },
        select: {
          currentEscalationStep: true,
          escalationStatus: true,
          service: {
            select: {
              policy: {
                select: {
                  name: true,
                  steps: {
                    orderBy: { stepOrder: 'asc' },
                    select: {
                      targetType: true,
                      targetUser: { select: { name: true } },
                      targetTeam: { select: { name: true } },
                      targetSchedule: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const steps = row?.service.policy?.steps ?? [];
      const next = row?.currentEscalationStep ?? 0;
      if (
        !row ||
        steps.length === 0 ||
        next >= steps.length ||
        row.escalationStatus === 'COMPLETED'
      )
        return null;
      // eslint-disable-next-line security/detect-object-injection -- bounded index into the ordered steps
      const step = steps[next];
      const target =
        step.targetSchedule?.name ?? step.targetTeam?.name ?? step.targetUser?.name ?? 'unnamed';
      return {
        title: 'Escalate now',
        detail: `Page escalation level ${next + 1} of ${steps.length} for ${subject} now, instead of waiting for the policy timer. People are notified immediately.`,
        preview: [
          { label: 'Policy', value: short(row.service.policy?.name ?? 'Escalation policy', 80) },
          {
            label: 'Pages',
            value: `${TARGET_LABEL[step.targetType] ?? 'target'} ${quoted(target, 60)}`,
          },
        ],
        confirmLabel: 'Escalate',
        impact: 'PAGES_PEOPLE',
      };
    }
    case 'change_urgency': {
      const { urgency } = input as Input<'change_urgency'>;
      if (!can(actor, CAPABILITIES.OPERATIONS_MANAGE) || incident.urgency === urgency) return null;
      return {
        title: 'Change urgency',
        detail: `Change the urgency of ${subject} from ${incident.urgency ?? 'its current value'} to ${urgency}. Notification and engagement rules for the new urgency apply from now on.`,
        preview: [
          { label: 'From', value: String(incident.urgency ?? 'unknown') },
          { label: 'To', value: urgency },
        ],
        confirmLabel: 'Change urgency',
      };
    }
    case 'snooze_incident': {
      const { minutes, reason } = input as Input<'snooze_incident'>;
      if (!can(actor, CAPABILITIES.OPERATIONS_MANAGE)) return null;
      if (!['OPEN', 'ACKNOWLEDGED', 'SNOOZED'].includes(incident.status)) return null;
      const until = new Date(now.getTime() + minutes * 60_000);
      return {
        title: 'Snooze incident',
        detail: `Snooze ${subject} for ${minutesLabel(minutes)}. Notifications and escalation pause until then, and it reopens automatically.`,
        preview: [
          { label: 'For', value: minutesLabel(minutes) },
          { label: 'Until about', value: utcClock(until) },
          ...(reason ? [{ label: 'Reason', value: short(reason, 200) }] : []),
        ],
        confirmLabel: 'Snooze',
      };
    }
    case 'unlink_related_incident': {
      const { otherIncidentId } = input as Input<'unlink_related_incident'>;
      if (!can(actor, CAPABILITIES.INTELLIGENCE_FEEDBACK) || otherIncidentId === incident.id)
        return null;
      const other = await readIncidentForActor(actor, otherIncidentId);
      if (!other) return null;
      const link = await activeLink(prisma, incident.id, otherIncidentId);
      if (!link) return null;
      return {
        title: 'Remove related link',
        detail: `Stop treating ${subject} and ${quoted(other.title)} as related. The link stays in the history and can be added again.`,
        confirmLabel: 'Remove link',
      };
    }
    case 'add_responder': {
      const { userId, role } = input as Input<'add_responder'>;
      const canManage = can(actor, CAPABILITIES.OPERATIONS_MANAGE);
      // Same rule as the incident page: without operations access you may only follow it yourself.
      if (!canManage && (userId !== actor.id || role !== 'FOLLOWER')) return null;
      let visible: Prisma.UserWhereInput = { id: actor.id };
      if (userId !== actor.id) {
        try {
          visible = dashboardUserReadWhere(actor);
        } catch {
          return null;
        }
      }
      const person = await prisma.user.findFirst({
        where: { AND: [{ id: userId, status: 'ACTIVE' }, visible] },
        select: { name: true, email: true },
      });
      if (!person) return null;
      const existing = await prisma.incidentWatcher.findUnique({
        where: { incidentId_userId: { incidentId: incident.id, userId } },
        select: { role: true },
      });
      if (existing?.role === role) return null;
      const who = userId === actor.id ? 'yourself' : short(person.name || person.email, 80);
      return {
        title: 'Add a watcher',
        detail: `Add ${who} to ${subject} as ${role.toLowerCase()}. Watchers get this incident's updates.`,
        preview: [
          { label: 'Person', value: who },
          { label: 'Role', value: role },
        ],
        confirmLabel: 'Add',
      };
    }
    case 'create_jira_issue': {
      if (!can(actor, CAPABILITIES.OPERATIONS_MANAGE)) return null;
      const row = await prisma.incident.findUnique({
        where: { id: incident.id },
        select: {
          serviceId: true,
          service: {
            select: {
              jiraServiceMapping: { select: { projectKey: true, incidentIssueType: true } },
            },
          },
        },
      });
      const mapping = row?.service.jiraServiceMapping;
      if (!row || !mapping?.projectKey) return null;
      const capability = await getJiraCapabilities({ serviceId: row.serviceId, canManage: true });
      if (!capability.canCreate) return null;
      if ((await jiraLinks(prisma, incident.id)) > 0) return null;
      return {
        title: 'Create a Jira issue',
        detail: `Create a Jira issue for ${subject} and link it to the incident. The incident title and description are sent to Jira.`,
        preview: [
          { label: 'Project', value: short(mapping.projectKey, 40) },
          { label: 'Issue type', value: short(mapping.incidentIssueType || 'Bug', 40) },
        ],
        confirmLabel: 'Create issue',
        impact: 'EXTERNAL_SYSTEM',
      };
    }
    case 'draft_status_update': {
      const { title, message, type } = input as Input<'draft_status_update'>;
      if (!can(actor, CAPABILITIES.ADMIN_MANAGE)) return null;
      const page = await resolveStatusPage(
        prisma,
        (input as Input<'draft_status_update'>).statusPageId
      );
      if (!page) return null;
      return {
        title: 'Draft a status update',
        detail: `Create an unpublished draft on the status page ${quoted(page.name)} about ${subject}. Nothing is public until you confirm the separate Publish step.`,
        preview: [
          { label: 'Type', value: type },
          { label: 'Title', value: short(title, 200) },
          { label: 'Message', value: short(message, 600) },
        ],
        confirmLabel: 'Create draft',
        step: 'Step 1 of 2',
      };
    }
    case 'publish_status_update': {
      const { statusPageId, announcementId } = input as Input<'publish_status_update'>;
      if (!can(actor, CAPABILITIES.ADMIN_MANAGE)) return null;
      const draft = await prisma.statusPageAnnouncement.findFirst({
        where: { id: announcementId, statusPageId, isActive: false },
        select: { title: true, message: true, statusPage: { select: { name: true } } },
      });
      if (!draft) return null;
      return {
        title: 'Publish the status update',
        detail: `Publish ${quoted(draft.title)} on ${quoted(draft.statusPage.name)} now. Anyone who can see the status page will see it. Subscribers are not notified from here.`,
        preview: [{ label: 'Message', value: short(draft.message, 600) }],
        confirmLabel: 'Publish',
        impact: 'PUBLIC',
        step: 'Step 2 of 2',
      };
    }
    case 'run_runbook': {
      if (!can(actor, CAPABILITIES.RUNBOOK_EXECUTE)) return null;
      const plan = await runbookPlan(prisma, actor, incident.id, String(input.runbookId));
      if (!plan) return null;
      return {
        title: 'Run runbook',
        detail: `Run ${quoted(plan.name)} (version ${plan.version}) against ${subject}. The runbook's own approval steps still apply; follow or cancel it on the incident's Runbooks tab.`,
        preview: [
          { label: 'Steps', value: String(plan.steps) },
          { label: 'Need approval', value: String(plan.approvals) },
          { label: 'Binding', value: short(plan.bindingName || 'Service binding', 60) },
        ],
        href: `/incidents/${encodeURIComponent(incident.id)}?tab=runbooks`,
        confirmLabel: 'Run runbook',
        impact: 'AUTOMATION',
      };
    }
  }
}

async function activeLink(client: Client, incidentId: string, otherIncidentId: string) {
  return client.incidentRelationship.findFirst({
    where: {
      type: 'RELATED',
      decision: 'ACCEPTED',
      OR: [
        { sourceIncidentId: incidentId, targetIncidentId: otherIncidentId },
        { sourceIncidentId: otherIncidentId, targetIncidentId: incidentId },
      ],
    },
    select: { id: true, decision: true, updatedAt: true },
  });
}

function jiraLinks(client: Client, incidentId: string) {
  return client.externalIssueLink.count({ where: { incidentId, provider: 'JIRA' } });
}

/** The named page, else the default page, else the only page. */
async function resolveStatusPage(client: Client, statusPageId: string | undefined) {
  if (statusPageId)
    return client.statusPage.findUnique({
      where: { id: statusPageId },
      select: { id: true, name: true },
    });
  const fallback = await client.statusPage.findFirst({
    where: { isDefault: true },
    select: { id: true, name: true },
  });
  if (fallback) return fallback;
  const pages = await client.statusPage.findMany({ take: 2, select: { id: true, name: true } });
  return pages.length === 1 ? pages[0] : null;
}

interface RunbookPlan {
  bindingId: string;
  bindingName: string;
  configurationRevision: number;
  runbookId: string;
  versionId: string;
  version: number;
  serviceId: string;
  name: string;
  steps: number;
  approvals: number;
}

/**
 * The binding on the incident's service that would run this runbook, read the same way as the incident
 * page's Runbooks tab: enabled, the pinned or latest published version, and no required input left empty.
 */
async function runbookPlan(
  client: Client,
  actor: AuthorizationActor,
  incidentId: string,
  runbookId: string
): Promise<RunbookPlan | null> {
  let readable: Prisma.RunbookWhereInput;
  try {
    readable = runbookReadWhere(actor);
  } catch {
    return null;
  }
  const incident = await client.incident.findUnique({
    where: { id: incidentId },
    select: { serviceId: true },
  });
  if (!incident) return null;
  const binding = await client.serviceAutomationRule.findFirst({
    where: {
      runbookId,
      serviceId: incident.serviceId,
      enabled: true,
      detachedAt: null,
      runbook: { AND: [readable, { archivedAt: null }] },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      configurationRevision: true,
      versionStrategy: true,
      runbookVersionId: true,
      inputValues: true,
      runbook: { select: { name: true, publishedVersionId: true } },
    },
  });
  if (!binding) return null;
  const versionId =
    binding.versionStrategy === 'PINNED'
      ? binding.runbookVersionId
      : binding.runbook.publishedVersionId;
  if (!versionId) return null;
  const version = await client.runbookVersion.findUnique({
    where: { id: versionId },
    select: {
      version: true,
      state: true,
      definition: true,
      inputs: { select: { key: true, required: true, defaultValue: true } },
    },
  });
  if (!version || version.state !== 'PUBLISHED') return null;
  const preset =
    binding.inputValues &&
    typeof binding.inputValues === 'object' &&
    !Array.isArray(binding.inputValues)
      ? (binding.inputValues as Record<string, unknown>)
      : {};
  // The assistant cannot ask for runbook inputs; those runs start from the Runbooks tab instead.
  if (
    version.inputs.some(
      field => field.required && field.defaultValue == null && !(field.key in preset)
    )
  )
    return null;
  let steps = 0;
  let approvals = 0;
  try {
    const flat = flattenSteps(parseRunbookDefinition(version.definition));
    steps = flat.length;
    approvals = flat.filter(step => step.type === 'APPROVAL' || step.requiresApproval).length;
  } catch {
    return null;
  }
  return {
    bindingId: binding.id,
    bindingName: binding.name,
    configurationRevision: binding.configurationRevision,
    runbookId,
    versionId,
    version: version.version,
    serviceId: incident.serviceId,
    name: binding.runbook.name,
    steps,
    approvals,
  };
}

/**
 * The facts a proposal depends on. Sealed into the proposal when it is made and read again inside the
 * executor's serializable transaction; any difference refuses the action as "changed since suggested".
 */
export async function extendedSnapshot(
  client: Client,
  actor: AuthorizationActor,
  name: ExtendedSquireActionName,
  input: Record<string, unknown>,
  incidentId: string
): Promise<Snapshot | null> {
  switch (name) {
    case 'escalate_incident': {
      const row = await client.incident.findUnique({
        where: { id: incidentId },
        select: {
          status: true,
          escalationGeneration: true,
          currentEscalationStep: true,
          escalationStatus: true,
        },
      });
      return row
        ? {
            status: row.status,
            escalationGeneration: row.escalationGeneration,
            currentEscalationStep: row.currentEscalationStep,
            escalationStatus: row.escalationStatus ?? null,
          }
        : null;
    }
    case 'change_urgency': {
      const row = await client.incident.findUnique({
        where: { id: incidentId },
        select: { urgency: true },
      });
      return row ? { urgency: row.urgency } : null;
    }
    case 'snooze_incident': {
      const row = await client.incident.findUnique({
        where: { id: incidentId },
        select: { status: true, escalationGeneration: true },
      });
      return row ? { status: row.status, escalationGeneration: row.escalationGeneration } : null;
    }
    case 'unlink_related_incident': {
      const link = await activeLink(client, incidentId, String(input.otherIncidentId));
      return link ? { relationshipId: link.id, updatedAt: link.updatedAt.toISOString() } : null;
    }
    case 'add_responder': {
      const existing = await client.incidentWatcher.findUnique({
        where: { incidentId_userId: { incidentId, userId: String(input.userId) } },
        select: { role: true },
      });
      return { watcherRole: existing?.role ?? null };
    }
    case 'create_jira_issue':
      return { jiraLinks: await jiraLinks(client, incidentId) };
    case 'draft_status_update': {
      const page = await resolveStatusPage(
        client,
        typeof input.statusPageId === 'string' ? input.statusPageId : undefined
      );
      return page ? { statusPageId: page.id } : null;
    }
    case 'publish_status_update': {
      const draft = await client.statusPageAnnouncement.findFirst({
        where: { id: String(input.announcementId), statusPageId: String(input.statusPageId) },
        select: { isActive: true, updatedAt: true },
      });
      return draft ? { isActive: draft.isActive, updatedAt: draft.updatedAt.toISOString() } : null;
    }
    case 'run_runbook': {
      const plan = await runbookPlan(client, actor, incidentId, String(input.runbookId));
      return plan
        ? {
            bindingId: plan.bindingId,
            configurationRevision: plan.configurationRevision,
            versionId: plan.versionId,
            serviceId: plan.serviceId,
          }
        : null;
    }
  }
}

/** Inside the executor's transaction: the sealed snapshot must still describe the world. */
export async function checkExtendedPreconditions(
  tx: Prisma.TransactionClient,
  actor: AuthorizationActor,
  name: ExtendedSquireActionName,
  input: Record<string, unknown>,
  incidentId: string,
  expected: Snapshot | undefined
): Promise<Snapshot> {
  const current = await extendedSnapshot(tx, actor, name, input, incidentId);
  if (!expected || !current || !isDeepStrictEqual(current, expected))
    throw new AppError({
      code: 'PRECONDITION_FAILED',
      userMessage:
        'The incident changed after this suggestion was prepared. Review it and ask for a fresh suggestion.',
    });
  return current;
}
