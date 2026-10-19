import 'server-only';
import type { IncidentEventType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanViewIncident, getUserPermissions } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { redactNotificationError } from '@/lib/notification-operations';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';
import {
  readIncidentResponseContext,
  type ResponseContextField,
  type ResponseContextReadResult,
} from '@/lib/automation/response-context';
import {
  getEscalationExecutionHealth,
  type EscalationExecutionHealth,
  type EscalationStepOutcome,
} from '@/lib/escalation/execution-health';
import {
  RESPONSE_LANES,
  clipText,
  isRunbookEventType,
  parseRecoveryOutcome,
  recoveryOutcomePresentation,
  resolutionKindLabel,
  runbookEventDisplay,
  runbookEventSignal,
  summarizeExecutionTarget,
  summarizeExecutionVerification,
  type RecoveryOutcome,
  type ResponseLane,
  type ResponseTone,
  type IncidentContextUnavailableReason,
  type RunbookEventSignal,
  type RunbookEventType,
} from './response-presentation';

export const RESPONSE_TIMELINE_LIMITS = {
  events: 200,
  notifications: 50,
  executions: 20,
  stepsPerExecution: 100,
  suggestions: 20,
  entries: 300,
} as const;

export type ResponseTimelineViewer = { capabilities: readonly string[] };

export type ResponseTimelineFact = { label: string; value: string };

/** The persisted record an entry was projected from; the UI turns it into a link. */
export type ResponseTimelineRecord =
  | { type: 'DECISION'; id: string }
  | { type: 'ESCALATION_STEP'; id: string }
  | { type: 'EXECUTION'; id: string }
  | { type: 'APPROVAL'; id: string; executionId: string }
  | { type: 'NOTIFICATION'; id: string }
  | { type: 'SUGGESTION'; id: string }
  | { type: 'EVENT'; id: string };

type EntryBase = {
  id: string;
  lane: ResponseLane;
  /** ISO-8601 timestamp. */
  at: string;
  title: string;
  detail: string | null;
  tone: ResponseTone;
  facts: ResponseTimelineFact[];
  record?: ResponseTimelineRecord;
};

export type ResponseTimelineEntry = EntryBase &
  (
    | { kind: 'INCIDENT_TRIGGERED' }
    | {
        kind: 'ROUTING_DECISION';
        mode: string;
        routeType: string;
        fallback: boolean;
      }
    | { kind: 'ESCALATION_STEP'; stepNumber: number; outcome: EscalationStepOutcome }
    | { kind: 'ESCALATION_EVENT' }
    | { kind: 'NOTIFICATION'; channel: string; status: string }
    | { kind: 'RUNBOOK_SUGGESTION'; state: string }
    | {
        kind: 'RUNBOOK_EXECUTION';
        executionId: string;
        status: string;
        phase: 'STARTED' | 'FINISHED';
      }
    | {
        kind: 'RUNBOOK_APPROVAL';
        executionId: string;
        stepId: string;
        state: 'REQUIRED' | 'APPROVED';
      }
    | { kind: 'RUNBOOK_EVENT'; eventType: RunbookEventType; signal: RunbookEventSignal }
    | { kind: 'WRITE_VERIFICATION'; executionId: string; stepId: string; verified: boolean }
    | { kind: 'RECOVERY_OUTCOME'; executionId: string; outcome: RecoveryOutcome }
    | {
        kind: 'LIFECYCLE';
        transition: 'ACKNOWLEDGED' | 'RESOLVED' | 'REOPENED';
        resolutionKind: string | null;
      }
  );

export type ResponseTimelineLaneState = {
  lane: ResponseLane;
  /** The viewer may see this lane at all. */
  visible: boolean;
  /** Part of the lane's detail is withheld from this viewer. */
  restricted: boolean;
  count: number;
};

export type IncidentContextFieldView = {
  key: string;
  type: ResponseContextField['type'];
  state: ResponseContextField['state'];
  source: ResponseContextField['source'];
  /** Display value; null when missing/unmapped or redacted. */
  value: string | null;
  redacted: boolean;
};

export type { IncidentContextUnavailableReason };

export type IncidentContextView =
  | { visibility: 'HIDDEN' }
  | {
      visibility: 'VISIBLE' | 'REDACTED';
      status: 'AVAILABLE';
      versionNumber: number;
      fields: IncidentContextFieldView[];
    }
  | {
      visibility: 'VISIBLE' | 'REDACTED';
      status: 'UNAVAILABLE';
      reason: IncidentContextUnavailableReason;
    };

export type IncidentResponseTimeline = {
  incidentId: string;
  entries: ResponseTimelineEntry[];
  /** One state per lane, in RESPONSE_LANES order. */
  lanes: ResponseTimelineLaneState[];
  context: IncidentContextView;
  /** A NO_ESCALATION incident whose remediation failed or was unverified; nobody is paged. */
  humanInterventionRequired: boolean;
  truncated: boolean;
};

const LIFECYCLE_EVENT_TYPES: IncidentEventType[] = [
  'ESCALATED',
  'ACKNOWLEDGED',
  'AUTO_RESOLVED',
  'MANUAL_RESOLVED',
  'REOPENED',
];
const RUNBOOK_TIMELINE_EVENT_TYPES: IncidentEventType[] = [
  'RUNBOOK_SKIPPED',
  'RUNBOOK_VERIFIED',
  'RUNBOOK_UNVERIFIED',
];
const TERMINAL_EXECUTION_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT']);
const ACTIVE_EXECUTION_STATUS = new Map<string, string>([
  ['QUEUED', 'Queued'],
  ['RUNNING', 'Running'],
  ['WAITING_AGENT', 'Waiting for an Agent'],
  ['WAITING_APPROVAL', 'Waiting for approval — paging continues'],
  ['PAUSED', 'Paused'],
  ['CANCEL_REQUESTED', 'Cancellation requested'],
]);
const UNCERTAIN_DETAIL =
  'A write action has an unknown outcome. It is never retried automatically; confirm the target state before re-running.';
const LEVEL_PATTERN = /\(Level (\d+)\b/;

const ROUTE_LABEL: Record<string, string> = {
  SERVICE_DEFAULT: 'Service default',
  ESCALATION_POLICY: 'Escalation policy',
  NO_ESCALATION: 'No escalation (paging skipped)',
};
const ESCALATION_OUTCOME: Record<EscalationStepOutcome, { label: string; tone: ResponseTone }> = {
  COMPLETED: { label: 'Executed', tone: 'oncall' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  RUNNING: { label: 'Running', tone: 'info' },
  FAILED: { label: 'Failed', tone: 'critical' },
  UNCERTAIN: { label: 'Outcome uncertain', tone: 'warning' },
};
const CHANNEL_LABEL: Record<string, string> = {
  SMS: 'SMS',
  VOICE: 'Voice call',
  WHATSAPP: 'WhatsApp',
  PUSH: 'Push',
  SLACK: 'Slack',
  MICROSOFT_TEAMS: 'Microsoft Teams',
  EMAIL: 'Email',
  WEBHOOK: 'Webhook',
};
const NOTIFICATION_STATUS: Record<string, { label: string; tone: ResponseTone }> = {
  PENDING: { label: 'queued', tone: 'info' },
  SENT: { label: 'accepted by provider', tone: 'oncall' },
  DELIVERED: { label: 'delivered', tone: 'oncall' },
  FAILED: { label: 'failed', tone: 'critical' },
  SKIPPED: { label: 'skipped', tone: 'neutral' },
  UNKNOWN: { label: 'delivery uncertain', tone: 'warning' },
};
const EXECUTION_STATUS: Record<string, { label: string; tone: ResponseTone }> = {
  SUCCEEDED: { label: 'succeeded', tone: 'success' },
  FAILED: { label: 'failed', tone: 'critical' },
  CANCELLED: { label: 'was cancelled', tone: 'neutral' },
  TIMED_OUT: { label: 'timed out', tone: 'critical' },
};
const TRIGGER_LABEL: Record<string, string> = {
  TRIGGER: 'Automatic (trigger)',
  API: 'API',
  CHATOPS: 'ChatOps',
  SCHEDULE: 'Schedule',
};
const iso = (value: Date | string) => (typeof value === 'string' ? value : value.toISOString());
const fact = (label: string, value: string | null | undefined): ResponseTimelineFact[] =>
  value ? [{ label, value: clipText(value, 200) }] : [];

function contextView(
  read: ResponseContextReadResult | null,
  canReadAutomation: boolean,
  sensitive: boolean
): IncidentContextView {
  if (!canReadAutomation || !read) return { visibility: 'HIDDEN' };
  const visibility = sensitive ? 'VISIBLE' : 'REDACTED';
  if (read.status === 'UNAVAILABLE')
    return { visibility, status: 'UNAVAILABLE', reason: read.reason };
  return {
    visibility,
    status: 'AVAILABLE',
    versionNumber: read.context.versionNumber,
    fields: read.context.fields.map(field => ({
      key: field.key,
      type: field.type,
      state: field.state,
      source: field.source,
      value:
        sensitive && field.state === 'RECOGNIZED' && field.value !== null
          ? clipText(String(field.value), 512)
          : null,
      redacted: !sensitive && field.state === 'RECOGNIZED',
    })),
  };
}

/**
 * Projects routing, paging, remediation, verification and recovery into one ordered
 * timeline. Callers must already have passed `assertCanViewIncident(incidentId)`;
 * `viewer` controls lane visibility and source-content redaction.
 */
export async function getIncidentResponseTimeline(
  incidentId: string,
  viewer: ResponseTimelineViewer,
  options: { escalationHealth?: EscalationExecutionHealth | null } = {}
): Promise<IncidentResponseTimeline | null> {
  const can = (capability: string) => viewer.capabilities.includes(capability);
  const canReadAutomation = can(CAPABILITIES.AUTOMATION_READ);
  const sensitive = can(CAPABILITIES.INCIDENT_SENSITIVE_READ);
  const canReadRunbooks =
    can(CAPABILITIES.RUNBOOK_READ_ALL) || can(CAPABILITIES.RUNBOOK_READ_SCOPED);

  const [incident, events, notifications, executions, suggestions, contextRead, health] =
    await Promise.all([
      prisma.incident.findUnique({
        where: { id: incidentId },
        select: {
          id: true,
          status: true,
          createdAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
          resolutionKind: true,
          automationSourceRestricted: true,
          automationTraces: { select: { incidentId: true }, take: 1 },
          automationDecision: {
            select: {
              incidentId: true,
              mode: true,
              routeType: true,
              escalationPolicyNameSnapshot: true,
              matchedRouteRuleName: true,
              basePriority: true,
              finalPriority: true,
              evaluationAt: true,
              fallbackReason: true,
              version: { select: { versionNumber: true } },
            },
          },
        },
      }),
      prisma.incidentEvent.findMany({
        where: {
          incidentId,
          type: {
            in: canReadRunbooks
              ? [...LIFECYCLE_EVENT_TYPES, ...RUNBOOK_TIMELINE_EVENT_TYPES]
              : LIFECYCLE_EVENT_TYPES,
          },
        },
        select: { id: true, type: true, message: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RESPONSE_TIMELINE_LIMITS.events,
      }),
      prisma.notification.findMany({
        where: { incidentId },
        select: {
          id: true,
          channel: true,
          status: true,
          recipientDisplay: true,
          errorMsg: true,
          createdAt: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
          user: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RESPONSE_TIMELINE_LIMITS.notifications,
      }),
      canReadRunbooks
        ? prisma.runbookExecution.findMany({
            where: { incidentId },
            select: {
              id: true,
              status: true,
              createdAt: true,
              startedAt: true,
              completedAt: true,
              triggeredByType: true,
              failureCode: true,
              targetSelection: true,
              unattendedWritesAuthorized: true,
              recoveryOutcome: true,
              recoveryCheckedAt: true,
              runbook: { select: { name: true } },
              runbookVersion: { select: { version: true } },
              triggeredByUser: { select: { name: true } },
              resolvedTargetAgent: { select: { name: true, hostname: true } },
              resolvedTargetAgentPool: { select: { name: true } },
              steps: {
                select: {
                  id: true,
                  stepKey: true,
                  name: true,
                  riskClass: true,
                  status: true,
                  requiresApproval: true,
                  startedAt: true,
                  approvedAt: true,
                  approvedBy: { select: { name: true } },
                  verificationResult: true,
                },
                orderBy: { sequence: 'asc' },
                take: RESPONSE_TIMELINE_LIMITS.stepsPerExecution,
              },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: RESPONSE_TIMELINE_LIMITS.executions,
          })
        : Promise.resolve([]),
      canReadRunbooks
        ? prisma.runbookSuggestion.findMany({
            where: { incidentId },
            select: {
              id: true,
              state: true,
              createdAt: true,
              startedAt: true,
              dismissedAt: true,
              binding: { select: { runbook: { select: { name: true } } } },
              runbookVersion: { select: { version: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: RESPONSE_TIMELINE_LIMITS.suggestions,
          })
        : Promise.resolve([]),
      canReadAutomation ? readIncidentResponseContext(prisma, incidentId) : Promise.resolve(null),
      options.escalationHealth !== undefined
        ? Promise.resolve(options.escalationHealth)
        : getEscalationExecutionHealth(incidentId).catch(error => {
            logger.warn('incident.response_timeline.escalation_health_unavailable', {
              incidentId,
              error,
            });
            return null;
          }),
    ]);
  if (!incident) return null;

  const decision = incident.automationDecision;
  const { events: visibleEvents } = visibleIncidentSource(
    {
      automationSourceRestricted:
        incident.automationSourceRestricted || !!decision || incident.automationTraces.length > 0,
      events: [...events].reverse(),
    },
    sensitive
  );

  const entries: ResponseTimelineEntry[] = [
    {
      id: `incident:${incident.id}`,
      kind: 'INCIDENT_TRIGGERED',
      lane: 'ROUTING',
      at: iso(incident.createdAt),
      title: 'Incident triggered',
      detail: null,
      tone: 'critical',
      facts: [],
    },
  ];

  if (decision && canReadAutomation) {
    const live = decision.mode === 'LIVE';
    const title = !live
      ? `Automation evaluated in ${decision.mode.toLowerCase()} mode`
      : decision.fallbackReason
        ? 'Automation fell back to service-default routing'
        : decision.matchedRouteRuleName
          ? `Matched rule: ${decision.matchedRouteRuleName}`
          : decision.routeType === 'NO_ESCALATION'
            ? 'Automation skipped personal paging'
            : 'No routing rule matched; service-default routing used';
    entries.push({
      id: `decision:${decision.incidentId}`,
      kind: 'ROUTING_DECISION',
      lane: 'ROUTING',
      at: iso(decision.evaluationAt),
      title: clipText(title, 200),
      detail: live ? null : 'Shadow decisions are recorded for review and do not change routing.',
      tone: decision.fallbackReason ? 'warning' : 'info',
      mode: decision.mode,
      routeType: decision.routeType,
      fallback: !!decision.fallbackReason,
      record: { type: 'DECISION', id: decision.incidentId },
      facts: [
        ...fact('Mode', decision.mode),
        ...fact(
          'Automation version',
          decision.version ? `v${decision.version.versionNumber}` : null
        ),
        ...fact('Matched rule', decision.matchedRouteRuleName),
        ...fact(
          'Priority',
          `${decision.basePriority ?? 'Unset'} → ${decision.finalPriority ?? 'Unset'}`
        ),
        ...fact('Route', ROUTE_LABEL[decision.routeType] ?? decision.routeType),
        ...fact('Escalation policy', decision.escalationPolicyNameSnapshot),
        ...fact('Fallback reason', decision.fallbackReason),
      ],
    });
  }

  // Paging: escalation steps fold in their "(Level N)" timeline evidence.
  const levelEvents = new Map<number, { at: string; message: string }>();
  for (const event of visibleEvents) {
    if (event.type !== 'ESCALATED') continue;
    const level = LEVEL_PATTERN.exec(event.message);
    if (level && health?.steps.some(step => step.stepNumber === Number(level[1]))) {
      if (!levelEvents.has(Number(level[1])))
        levelEvents.set(Number(level[1]), { at: iso(event.createdAt), message: event.message });
      continue;
    }
    entries.push({
      id: `event:${event.id}`,
      kind: 'ESCALATION_EVENT',
      lane: 'PAGING',
      at: iso(event.createdAt),
      title: 'Escalation',
      detail: clipText(event.message, 400),
      tone: 'oncall',
      facts: [],
      record: { type: 'EVENT', id: event.id },
    });
  }
  for (const step of health?.steps ?? []) {
    const evidence = levelEvents.get(step.stepNumber);
    const outcome = ESCALATION_OUTCOME[step.outcome];
    entries.push({
      id: `escalation:${health?.generation ?? 0}:${step.stepIndex}`,
      kind: 'ESCALATION_STEP',
      lane: 'PAGING',
      at: step.completedAt ?? step.failedAt ?? evidence?.at ?? iso(incident.createdAt),
      title: clipText(
        `Escalation step ${step.stepNumber}${step.targetLabel ? ` · ${step.targetLabel}` : ''}`,
        200
      ),
      detail: evidence ? clipText(evidence.message, 400) : null,
      tone: outcome.tone,
      stepNumber: step.stepNumber,
      outcome: step.outcome,
      record: { type: 'ESCALATION_STEP', id: String(step.stepIndex) },
      facts: [
        ...fact('Outcome', outcome.label),
        ...fact(
          'Attempts',
          step.maxAttempts > 0 && step.outcome !== 'COMPLETED'
            ? `${step.attempts} of ${step.maxAttempts}`
            : null
        ),
        ...fact('Error', step.error),
      ],
    });
  }
  for (const notification of notifications) {
    const status = NOTIFICATION_STATUS[notification.status] ?? NOTIFICATION_STATUS.PENDING;
    const channel = CHANNEL_LABEL[notification.channel] ?? notification.channel;
    const target = notification.user?.name || notification.recipientDisplay || 'responder';
    const at =
      notification.status === 'FAILED' || notification.status === 'UNKNOWN'
        ? (notification.failedAt ?? notification.sentAt ?? notification.createdAt)
        : notification.status === 'DELIVERED'
          ? (notification.deliveredAt ?? notification.sentAt ?? notification.createdAt)
          : (notification.sentAt ?? notification.createdAt);
    entries.push({
      id: `notification:${notification.id}`,
      kind: 'NOTIFICATION',
      lane: 'PAGING',
      at: iso(at),
      title: clipText(`${channel} notification ${status.label} · ${target}`, 200),
      detail: null,
      tone: status.tone,
      channel: notification.channel,
      status: notification.status,
      facts: fact('Error', redactNotificationError(notification.errorMsg)),
      record: { type: 'NOTIFICATION', id: notification.id },
    });
  }

  for (const suggestion of suggestions) {
    entries.push({
      id: `suggestion:${suggestion.id}`,
      kind: 'RUNBOOK_SUGGESTION',
      lane: 'REMEDIATION',
      at: iso(suggestion.createdAt),
      title: clipText(`Runbook suggested: ${suggestion.binding.runbook.name}`, 200),
      detail: null,
      tone: 'info',
      state: suggestion.state,
      record: { type: 'SUGGESTION', id: suggestion.id },
      facts: [
        ...fact('Version', `v${suggestion.runbookVersion.version}`),
        ...fact(
          'State',
          suggestion.state === 'STARTED'
            ? 'Started'
            : suggestion.state === 'DISMISSED'
              ? 'Dismissed'
              : 'Awaiting responder'
        ),
      ],
    });
  }

  for (const execution of executions) {
    const name = execution.runbook.name;
    const target = summarizeExecutionTarget(execution.targetSelection, sensitive);
    const verification = summarizeExecutionVerification(execution.steps);
    const targetLabel = execution.resolvedTargetAgent
      ? `${execution.resolvedTargetAgent.name}${execution.resolvedTargetAgent.hostname ? ` (${execution.resolvedTargetAgent.hostname})` : ''}`
      : execution.resolvedTargetAgentPool
        ? `Pool: ${execution.resolvedTargetAgentPool.name}`
        : target.implicitLocalHost
          ? 'Local host Agent'
          : 'OpsKnight control plane';
    const startedBy =
      execution.triggeredByType === 'USER'
        ? `Started by ${execution.triggeredByUser?.name ?? 'a responder'}`
        : (TRIGGER_LABEL[execution.triggeredByType] ?? execution.triggeredByType);
    entries.push({
      id: `execution:${execution.id}:started`,
      kind: 'RUNBOOK_EXECUTION',
      lane: 'REMEDIATION',
      at: iso(execution.startedAt ?? execution.createdAt),
      title: clipText(`Runbook started: ${name}`, 200),
      detail: null,
      tone: 'warning',
      executionId: execution.id,
      status: execution.status,
      phase: 'STARTED',
      record: { type: 'EXECUTION', id: execution.id },
      facts: [
        ...fact('Version', `v${execution.runbookVersion.version}`),
        ...fact('Trigger', startedBy),
        ...fact('Current status', ACTIVE_EXECUTION_STATUS.get(execution.status)),
        ...fact('Target', targetLabel),
        ...fact(
          'Target labels',
          target.labels.map(label => `${label.key}=${label.value ?? '[restricted]'}`).join(', ') ||
            null
        ),
        ...fact('Context keys', target.contextKeys.join(', ') || null),
        ...fact(
          'Write actions',
          verification.writeActions.length
            ? execution.unattendedWritesAuthorized
              ? 'Unattended writes authorized'
              : 'Approval required'
            : null
        ),
      ],
    });
    if (TERMINAL_EXECUTION_STATUSES.has(execution.status)) {
      const status = EXECUTION_STATUS[execution.status];
      entries.push({
        id: `execution:${execution.id}:finished`,
        kind: 'RUNBOOK_EXECUTION',
        lane: 'REMEDIATION',
        at: iso(execution.completedAt ?? execution.startedAt ?? execution.createdAt),
        title: clipText(`Runbook ${status.label}: ${name}`, 200),
        detail:
          execution.failureCode === 'UNKNOWN_OUTCOME' ||
          execution.steps.some(step => step.status === 'UNKNOWN')
            ? UNCERTAIN_DETAIL
            : null,
        tone:
          execution.failureCode === 'UNKNOWN_OUTCOME' && status.tone !== 'success'
            ? 'warning'
            : status.tone,
        executionId: execution.id,
        status: execution.status,
        phase: 'FINISHED',
        record: { type: 'EXECUTION', id: execution.id },
        facts: fact('Failure code', execution.failureCode),
      });
    }
    for (const step of execution.steps) {
      if (!step.requiresApproval) continue;
      if (step.approvedAt) {
        entries.push({
          id: `approval:${step.id}`,
          kind: 'RUNBOOK_APPROVAL',
          lane: 'REMEDIATION',
          at: iso(step.approvedAt),
          title: clipText(`Step approved: ${step.name}`, 200),
          detail: null,
          tone: 'info',
          executionId: execution.id,
          stepId: step.id,
          state: 'APPROVED',
          record: { type: 'APPROVAL', id: step.id, executionId: execution.id },
          facts: [
            ...fact('Runbook', name),
            ...fact('Approved by', step.approvedBy?.name ?? 'A responder'),
            ...fact('Risk', step.riskClass.replaceAll('_', ' ')),
          ],
        });
      } else if (step.status === 'WAITING_APPROVAL') {
        entries.push({
          id: `approval:${step.id}`,
          kind: 'RUNBOOK_APPROVAL',
          lane: 'REMEDIATION',
          at: iso(step.startedAt ?? execution.startedAt ?? execution.createdAt),
          title: clipText(`Approval required: ${step.name}`, 200),
          detail: 'Waiting for a responder. Paging is not delayed by this approval.',
          tone: 'warning',
          executionId: execution.id,
          stepId: step.id,
          state: 'REQUIRED',
          record: { type: 'APPROVAL', id: step.id, executionId: execution.id },
          facts: [...fact('Runbook', name), ...fact('Risk', step.riskClass.replaceAll('_', ' '))],
        });
      }
    }
    for (const action of verification.writeActions) {
      if (action.verified === null || !action.capturedAt) continue;
      entries.push({
        id: `verification:${action.stepId}`,
        kind: 'WRITE_VERIFICATION',
        lane: 'VERIFICATION',
        at: action.capturedAt,
        title: clipText(`${action.verified ? 'Verified' : 'Not verified'}: ${action.name}`, 200),
        detail: action.reason ? clipText(redactRunbookOutput(action.reason), 300) : null,
        tone: action.verified ? 'success' : 'warning',
        executionId: execution.id,
        stepId: action.stepId,
        verified: action.verified,
        record: { type: 'EXECUTION', id: execution.id },
        facts: [...fact('Runbook', name), ...fact('Risk', action.riskClass.replaceAll('_', ' '))],
      });
    }
    const outcome = parseRecoveryOutcome(execution.recoveryOutcome);
    if (outcome && outcome !== 'NOT_REQUESTED') {
      const presentation = recoveryOutcomePresentation(outcome);
      entries.push({
        id: `recovery:${execution.id}`,
        kind: 'RECOVERY_OUTCOME',
        lane: 'RECOVERY',
        at: iso(execution.recoveryCheckedAt ?? execution.completedAt ?? execution.createdAt),
        title: clipText(`${presentation.label}: ${name}`, 200),
        detail: presentation.description,
        tone: presentation.tone,
        executionId: execution.id,
        outcome,
        record: { type: 'EXECUTION', id: execution.id },
        facts: [],
      });
    }
  }

  const resolveEvents = visibleEvents.filter(
    event => event.type === 'AUTO_RESOLVED' || event.type === 'MANUAL_RESOLVED'
  );
  const latestResolve = resolveEvents.at(-1);
  let acknowledged = false;
  let humanInterventionRequired = false;
  for (const event of visibleEvents) {
    if (event.type && isRunbookEventType(event.type)) {
      if (!canReadRunbooks) continue;
      const signal = runbookEventSignal(event.type, event.message);
      const presentation = runbookEventDisplay(event.type, event.message);
      if (signal === 'HUMAN_INTERVENTION') humanInterventionRequired = true;
      entries.push({
        id: `event:${event.id}`,
        kind: 'RUNBOOK_EVENT',
        lane: signal
          ? 'RECOVERY'
          : event.type === 'RUNBOOK_SKIPPED'
            ? 'REMEDIATION'
            : 'VERIFICATION',
        at: iso(event.createdAt),
        title: presentation.label,
        detail: clipText(event.message, 400),
        tone: presentation.tone,
        eventType: event.type,
        signal,
        record: { type: 'EVENT', id: event.id },
        facts: [],
      });
      continue;
    }
    if (event.type === 'AUTO_RESOLVED' || event.type === 'MANUAL_RESOLVED')
      humanInterventionRequired = false;
    if (event.type === 'ACKNOWLEDGED') {
      acknowledged = true;
      entries.push({
        id: `event:${event.id}`,
        kind: 'LIFECYCLE',
        lane: 'RECOVERY',
        at: iso(event.createdAt),
        title: 'Acknowledged',
        detail: clipText(event.message, 400),
        tone: 'warning',
        transition: 'ACKNOWLEDGED',
        resolutionKind: null,
        facts: [],
      });
    } else if (event.type === 'REOPENED') {
      entries.push({
        id: `event:${event.id}`,
        kind: 'LIFECYCLE',
        lane: 'RECOVERY',
        at: iso(event.createdAt),
        title: 'Reopened',
        detail: clipText(event.message, 400),
        tone: 'critical',
        transition: 'REOPENED',
        resolutionKind: null,
        facts: [],
      });
    } else if (event.type === 'AUTO_RESOLVED' || event.type === 'MANUAL_RESOLVED') {
      const kind =
        event === latestResolve && incident.status === 'RESOLVED' && incident.resolutionKind
          ? incident.resolutionKind
          : event.type === 'AUTO_RESOLVED'
            ? 'SOURCE_RECOVERY'
            : null;
      entries.push({
        id: `event:${event.id}`,
        kind: 'LIFECYCLE',
        lane: 'RECOVERY',
        at: iso(event.createdAt),
        title: 'Resolved',
        detail: clipText(event.message, 400),
        tone: 'success',
        transition: 'RESOLVED',
        resolutionKind: kind,
        facts: fact('Resolution', kind ? resolutionKindLabel(kind) : null),
      });
    }
  }
  if (!acknowledged && incident.acknowledgedAt) {
    entries.push({
      id: `incident:${incident.id}:acknowledged`,
      kind: 'LIFECYCLE',
      lane: 'RECOVERY',
      at: iso(incident.acknowledgedAt),
      title: 'Acknowledged',
      detail: null,
      tone: 'warning',
      transition: 'ACKNOWLEDGED',
      resolutionKind: null,
      facts: [],
    });
  }
  if (!latestResolve && incident.status === 'RESOLVED' && incident.resolvedAt) {
    const kind = incident.resolutionKind ?? null;
    entries.push({
      id: `incident:${incident.id}:resolved`,
      kind: 'LIFECYCLE',
      lane: 'RECOVERY',
      at: iso(incident.resolvedAt),
      title: 'Resolved',
      detail: null,
      tone: 'success',
      transition: 'RESOLVED',
      resolutionKind: kind,
      facts: fact('Resolution', kind ? resolutionKindLabel(kind) : null),
    });
  }

  for (const entry of entries)
    if (!entry.record && entry.id.startsWith('event:'))
      entry.record = { type: 'EVENT', id: entry.id.slice('event:'.length) };

  const laneOrder = new Map(RESPONSE_LANES.map((lane, index) => [lane, index]));
  entries.sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      (laneOrder.get(a.lane) ?? 0) - (laneOrder.get(b.lane) ?? 0) ||
      Number(b.kind === 'INCIDENT_TRIGGERED') - Number(a.kind === 'INCIDENT_TRIGGERED') ||
      a.id.localeCompare(b.id)
  );
  const truncated = entries.length > RESPONSE_TIMELINE_LIMITS.entries;
  const bounded = truncated
    ? [
        ...entries.filter(entry => entry.lane === 'ROUTING'),
        ...entries
          .filter(entry => entry.lane !== 'ROUTING')
          .slice(-(RESPONSE_TIMELINE_LIMITS.entries - 2)),
      ]
    : entries;

  const count = (lane: ResponseLane) => bounded.filter(entry => entry.lane === lane).length;
  return {
    incidentId: incident.id,
    entries: bounded,
    truncated,
    lanes: RESPONSE_LANES.map(lane => ({
      lane,
      visible: lane === 'REMEDIATION' || lane === 'VERIFICATION' ? canReadRunbooks : true,
      restricted:
        (lane === 'ROUTING' && !canReadAutomation) || (lane === 'RECOVERY' && !canReadRunbooks),
      count: count(lane),
    })),
    context: contextView(contextRead, canReadAutomation, sensitive),
    humanInterventionRequired: humanInterventionRequired && incident.status !== 'RESOLVED',
  };
}

/** Access-checked entry point for routes and server components that have not yet authorized. */
export async function loadIncidentResponseTimeline(
  incidentId: string,
  options: { escalationHealth?: EscalationExecutionHealth | null } = {}
): Promise<IncidentResponseTimeline | null> {
  await assertCanViewIncident(incidentId);
  const permissions = await getUserPermissions();
  return getIncidentResponseTimeline(incidentId, permissions, options);
}
