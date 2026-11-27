import IncidentInsights, {
  IncidentGroupLine,
  IncidentTimelineWithIntelligence,
  SuggestedRunbooks,
} from './intelligence/IncidentInsights';
import prisma from '@/lib/prisma';
import { readPayload } from '@/lib/payload-reader';
import IncidentAuditView from '@/components/incident/detail/IncidentAuditView';
import { priorityReason } from '@/lib/incidents/priority-reason';
import IncidentLiveRefresh from '@/components/incident/IncidentLiveRefresh';
import CardSkeleton from '@/components/incident/detail/CardSkeleton';
import { getCachedOrFetch } from '@/lib/realtime-cache';
import FollowControl from '@/components/incident/detail/FollowControl';
import ShareMenu, { CopyIdText } from '@/components/incident/detail/ShareMenu';
import ResponseRow from '@/components/incident/detail/ResponseRow';
import { formatRelativeShort } from '@/lib/mobile-time';
import IncidentViewers from '@/components/incident/detail/IncidentViewers';
import { incidentSummaryText } from '@/lib/incidents/summary-text';
import IncidentShortcuts from '@/components/incident/IncidentShortcuts';
import { catchUpKind, type CatchUpItem } from '@/lib/incidents/catch-up';
import CatchUpStrip from '@/components/incident/detail/CatchUpStrip';
import { baselineLabel, computeBaseline } from '@/lib/incidents/baseline';
import IncidentAlertsView from '@/components/incident/detail/IncidentAlertsView';
import IncidentCustomerCommsCard from '@/components/incident/detail/IncidentCustomerCommsCard';
import IncidentRespondersCard from '@/components/incident/detail/IncidentRespondersCard';
import { incidentReadWhere } from '@/lib/authorization-filters';
import DedupRecurrenceChip from '@/components/incident/detail/DedupRecurrenceChip';
import { CHAT_EVENT_DISPLAY_MAX, LIFECYCLE_EVENT_WHERE } from '@/lib/incidents/event-filters';
import { Suspense } from 'react';
import UserAvatar from '@/components/UserAvatar';
import { incidentStatusTone } from '@/lib/design/status-palette';
import IncidentAutomationCard from '@/components/automation/IncidentAutomationCard';
import EscalationExecutionHealth from '@/components/incident/detail/EscalationExecutionHealth';
import { getEscalationExecutionHealth } from '@/lib/escalation/execution-health';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';
import { CAPABILITIES, isPageableRole } from '@/lib/authorization';
import { resolveEffectivePolicyForRequest } from '@/lib/intelligence/settings/service';
import { getAiSettings } from '@/lib/intelligence/ai/settings';
import { loadIncidentStatusUpdate } from '@/lib/intelligence/helpers/status-draft-loader';
import { draftIncidentSummaryNoteAction } from '@/app/(app)/incidents/[id]/intelligence-actions';
import Link from 'next/link';
import ListReturnLink from '@/components/layout/ListReturnLink';
import { notFound } from 'next/navigation';
import {
  assertCanViewIncident,
  getCurrentAuthorizationActor,
  getIncidentOperatorPermissions,
  getUserPermissions,
} from '@/lib/rbac';
import { type IncidentRoleSlot } from '@/components/incident/detail/IncidentRoles';
import NotifyStakeholdersButton from '@/components/incident/detail/NotifyStakeholdersButton';
import { impactedBusinessServicesForIncident } from '@/lib/business-services/commands';
import { INCIDENT_ROLES } from '@/lib/incidents/roles';
import { loadIncidentRoleAccess } from '@/lib/incidents/role-access';
import { denyResourceAccess } from '@/lib/access/server';
import { getPostmortem } from '@/app/(app)/postmortems/actions';
import IncidentHeader from '@/components/incident/IncidentHeader';
import IncidentWatchers from '@/components/incident/detail/IncidentWatchers';
import IncidentExperts from '@/components/incident/detail/IncidentExperts';
import IncidentCommandBar from '@/components/incident/detail/IncidentCommandBar';
import IncidentDetailTabs from '@/components/incident/IncidentDetailTabs';
import IncidentRunbooks from '@/components/incident/IncidentRunbooks';
import IncidentNotes from '@/components/incident/detail/IncidentNotes';
import IncidentTimeline from '@/components/incident/detail/IncidentTimeline';
import IncidentResolutionSummary from '@/components/incident/detail/IncidentResolutionSummary';
import IncidentPostmortemTabContent from '@/components/incident/detail/IncidentPostmortemTabContent';
import IncidentDescriptionCard from '@/components/incident/detail/IncidentDescriptionCard';
import IncidentSLABadges from '@/components/incident/detail/IncidentSLABadges';
import IncidentCustomFieldsCard from '@/components/incident/detail/IncidentCustomFieldsCard';
import IncidentQuickLinksCard from '@/components/incident/detail/IncidentQuickLinksCard';
import IncidentResponseTimeline from '@/components/incident/detail/IncidentResponseTimeline';
import IncidentContextCard from '@/components/incident/detail/IncidentContextCard';
import { getIncidentResponseTimeline } from '@/lib/incidents/response-timeline';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import MobileOperationalContextCard from '@/components/incident/MobileOperationalContextCard';
import {
  IncidentStatusBadge,
  IncidentUrgencyBadge,
} from '@/components/incident/IncidentSemanticBadge';
import {
  acknowledgeIncidentDetail,
  addIncidentDetailNote,
  addIncidentDetailWatcher,
  removeIncidentDetailWatcher,
  reopenIncidentDetail,
  setIncidentDetailRole,
  suppressIncidentDetail,
  updateIncidentDetailDescription,
} from '@/components/incident/detail/actions';
import { projectIncidentSlaState } from '@/lib/incident-sla/state';
import { Badge } from '@/components/ui/shadcn/badge';
import StatusBadge from '@/components/patterns/StatusBadge';
import { getAppUrl } from '@/lib/app-url';
import { redactNotificationError } from '@/lib/notification-operations';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Network,
  Pause,
  Settings,
  Volume2,
  Wrench,
} from 'lucide-react';
import { getJiraCapabilities } from '@/lib/jira-capabilities';
import { serializeJiraIssueReference } from '@/lib/jira-references';
import { getIncidentCollaborationView } from '@/lib/incident-collaboration/get-incident-collaboration';

// Only the user fields client components render; full rows carry passwordHash,
// phone numbers and token state that must never reach the RSC payload.
const CLIENT_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  gender: true,
} as const;

export type IncidentDetailScreenProps = {
  id: string;
  backHref: string;
  backLabel?: string;
  presentation?: 'desktop' | 'mobile';
  initialTab?: string;
};

/**
 * Canonical incident-detail data and feature surface used by desktop and PWA.
 * The presentation flag changes composition only; permissions, actions and
 * operational capabilities stay shared.
 */

/** Soft status tile beside the title (DESIGN.md: status hues mean status; no gradient decoration). */
const STATUS_TILE: Record<string, string> = {
  critical:
    'bg-status-critical-soft text-status-critical-deep ring-status-critical-border/25 dark:bg-status-critical/15 dark:text-rose-300',
  elevated:
    'bg-status-elevated-soft text-status-elevated-deep ring-status-elevated-border/25 dark:bg-status-elevated/15 dark:text-amber-300',
  ok: 'bg-status-ok-soft text-status-ok-deep ring-status-ok-border/25 dark:bg-status-ok/15 dark:text-emerald-300',
  info: 'bg-status-info-soft text-status-info-deep ring-status-info-border/25 dark:bg-status-info/15 dark:text-blue-300',
  none: 'bg-muted text-muted-foreground ring-border',
};

export default async function IncidentDetailScreen({
  id,
  backHref,
  backLabel = 'Back to Incidents',
  presentation = 'desktop',
  initialTab,
}: IncidentDetailScreenProps) {
  const user = await assertCanViewIncident(id).catch(async (error: unknown) => {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'INCIDENT_NOT_FOUND') notFound();
    if (code === 'INCIDENT_ACCESS_DENIED' || code === 'AUTHORIZATION_DENIED')
      return denyResourceAccess({ resource: 'incident', id });
    throw error;
  });
  const appUrl = await getAppUrl();
  const storedIncident = await prisma.incident.findUnique({
    where: { id },
    include: {
      automationTraces: { select: { incidentId: true }, take: 1 },
      automationDecision: {
        select: {
          incidentId: true,
          mode: true,
          routeType: true,
          escalationPolicyId: true,
          escalationPolicyNameSnapshot: true,
        },
      },
      service: {
        include: {
          policy: true,
          jiraServiceMapping: { select: { projectKey: true } },
          slackIntegration: {
            select: { id: true, enabled: true, workspaceId: true },
          },
        },
      },
      assignee: { select: CLIENT_USER_SELECT },
      team: { select: { id: true, name: true } },
      // Captured chat is read separately below so it cannot push lifecycle events out of the window.
      events: {
        where: LIFECYCLE_EVENT_WHERE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      },
      notes: {
        include: { user: { select: CLIENT_USER_SELECT } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      },
      notifications: {
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
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      },
      watchers: {
        include: { user: { select: CLIENT_USER_SELECT } },
        orderBy: { createdAt: 'asc' },
      },
      roleAssignments: { select: { roleKey: true, user: { select: CLIENT_USER_SELECT } } },
      tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
      customFieldValues: { include: { customField: true } },
      maintenanceWindow: { select: { id: true, title: true, endsAt: true } },
    },
  });

  if (!storedIncident) notFound();
  const permissions = await getUserPermissions();
  const canReadIntelligence = permissions.capabilities.includes(
    CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ
  );
  // The service's mode decides every intelligence surface on this page. OFF renders nothing for responders;
  // intelligence managers alone can still open the inspector, which then explains that it is off.
  const intelligenceMode = canReadIntelligence
    ? await resolveEffectivePolicyForRequest(storedIncident.serviceId)
        .then(policy => policy.effectiveMode)
        .catch(() => 'OFF' as const)
    : ('OFF' as const);
  const showIntelligence = canReadIntelligence && intelligenceMode !== 'OFF';
  const showInsightsInspector =
    showIntelligence ||
    (canReadIntelligence && permissions.capabilities.includes(CAPABILITIES.INTELLIGENCE_MANAGE));
  const sensitive = permissions.capabilities.includes(CAPABILITIES.INCIDENT_SENSITIVE_READ);
  const sourceRestricted =
    (storedIncident.automationSourceRestricted ||
      !!storedIncident.automationDecision ||
      storedIncident.automationTraces.length > 0) &&
    !sensitive;
  const decision = storedIncident.automationDecision;
  const incidentPolicy =
    decision?.mode === 'LIVE'
      ? decision.escalationPolicyId
        ? {
            id: decision.escalationPolicyId,
            name: decision.escalationPolicyNameSnapshot ?? 'Pinned policy',
          }
        : null
      : storedIncident.service.policy;
  const incident = {
    ...visibleIncidentSource(storedIncident, sensitive),
    // The incident is serialized to client components: never ship webhook secrets.
    service: { ...storedIncident.service, slackWebhookUrl: null, webhookUrl: null },
    incidentPolicy,
    noEscalation: decision?.mode === 'LIVE' && decision.routeType === 'NO_ESCALATION',
  };
  const incidentSla = projectIncidentSlaState(incident, { now: new Date() });
  const canReadRunbooks =
    permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_ALL) ||
    permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_SCOPED);
  const canManageIncident = permissions.isResponderOrAbove;
  const operator = await getIncidentOperatorPermissions(id);
  const canAcknowledgeIncident = operator.canAcknowledge;
  const roleAccess = await loadIncidentRoleAccess(await getCurrentAuthorizationActor(), id);
  const canAssignRolesToOthers = Object.values(roleAccess?.access.canAssignOthers ?? {}).some(
    Boolean
  );
  const canAddIncidentNote = operator.canAddNote;
  const canResolveIncident = operator.canResolve;
  const canReadAutomation =
    permissions.capabilities.includes(CAPABILITIES.AUTOMATION_READ) &&
    !!storedIncident.automationDecision;

  const [
    users,
    teams,
    customFields,
    totalEventsCount,
    totalNotesCount,
    totalNotificationsCount,
    chatEvents,
  ] = await Promise.all([
    canManageIncident || canAssignRolesToOthers
      ? prisma.user.findMany({
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            gender: true,
            role: true,
          },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    canManageIncident
      ? prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : Promise.resolve([]),
    prisma.customField.findMany({ orderBy: { order: 'asc' } }),
    prisma.incidentEvent.count({ where: { incidentId: id } }),
    prisma.incidentNote.count({ where: { incidentId: id } }),
    prisma.notification.count({ where: { incidentId: id } }),
    prisma.incidentEvent.findMany({
      where: { incidentId: id, type: 'CHAT_MESSAGE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CHAT_EVENT_DISPLAY_MAX,
    }),
  ]);
  const events = [...incident.events, ...chatEvents].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)
  );

  const totalActivityCount = totalEventsCount + totalNotesCount + totalNotificationsCount;

  const incidentJiraCapability = await getJiraCapabilities({
    serviceId: incident.serviceId,
    canManage: canManageIncident,
  });
  // Not gated on RESOLVED: a reopened incident still has its postmortem.
  const postmortem = await getPostmortem(id);

  // Rendering an incident must not perform hidden Jira or provider network I/O.
  // Persisted state is refreshed by background webhooks or explicit sync actions.
  // One clock read per render: the baseline window and the "running long" line use the same instant.
  const pageRenderedAt = new Date();
  const [
    jiraLinks,
    collaboration,
    escalationHealth,
    statusUpdate,
    alertTotal,
    previousOnKey,
    baselineRows,
  ] = await Promise.all([
    prisma.externalIssueLink.findMany({
      where: { incidentId: id, provider: 'JIRA' },
      orderBy: { createdAt: 'desc' },
    }),
    // A war-room or meeting read failure must not blank the page responders need; the
    // controls simply stay hidden.
    getIncidentCollaborationView({ incidentId: id, userId: user.id }).catch(error => {
      logger.warn('incident.collaboration_view.unavailable', { incidentId: id, error });
      return undefined;
    }),
    // A health read failure must not block the incident page.
    getEscalationExecutionHealth(id).catch(() => null),
    // "Post status update": the status-page publish permission (admin), like the announcement API.
    permissions.capabilities.includes(CAPABILITIES.ADMIN_MANAGE)
      ? loadIncidentStatusUpdate(storedIncident).catch(() => null)
      : null,
    // One indexed COUNT: the Timeline graph reads its own aggregated data when it is shown.
    prisma.alert.count({ where: { incidentId: id } }),
    // The last earlier incident on the same dedup key the viewer may read: "first in 41 days".
    loadPreviousOnDedupKey(id, storedIncident.dedupKey ?? null, storedIncident.createdAt),
    // The service's usual response times: its recent resolved incidents (bounded), cached per service for
    // 10 minutes so busy incidents and live refreshes do not re-read them.
    getCachedOrFetch(
      `incident-baseline:${storedIncident.serviceId}`,
      () =>
        prisma.incident.findMany({
          where: {
            serviceId: storedIncident.serviceId,
            status: 'RESOLVED',
            resolvedAt: { not: null },
            createdAt: { gte: new Date(pageRenderedAt.getTime() - 90 * 86_400_000) },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { createdAt: true, acknowledgedAt: true, resolvedAt: true },
        }),
      10 * 60_000
    )
      .then(entry => entry.data)
      .catch(() => []),
  ]);
  const serviceBaseline = baselineLabel(
    computeBaseline(baselineRows),
    storedIncident.createdAt,
    storedIncident.resolvedAt ?? null,
    pageRenderedAt.getTime()
  );

  // The access check above already ran; the viewer's capabilities drive lane redaction.
  const responseTimeline = await getIncidentResponseTimeline(id, permissions, {
    escalationHealth,
  }).catch(error => {
    logger.warn('incident.response_timeline.unavailable', { incidentId: id, error });
    return null;
  });
  const userTimeZone = getUserTimeZone(user);

  const incidentJiraIssues = jiraLinks.map(serializeJiraIssueReference);
  const resolutionNote =
    incident.notes.find(note => note.content.startsWith('Resolution:')) ?? null;

  const handleAddNote = addIncidentDetailNote.bind(null, id);
  const handleAcknowledge = acknowledgeIncidentDetail.bind(null, id);
  const handleReopen = reopenIncidentDetail.bind(null, id, incident.status);
  const handleSuppress = suppressIncidentDetail.bind(null, id);
  const handleAddWatcher = addIncidentDetailWatcher.bind(null, id);
  const handleRemoveWatcher = removeIncidentDetailWatcher.bind(null, id);
  const handleUpdateDescription = updateIncidentDetailDescription.bind(null, id);

  const statusTone = incidentStatusTone(incident.status);

  // "Insert summary" in the note composer: only where summaries exist and the viewer may post a note.
  const canInsertSummary =
    showIntelligence && (canManageIncident || canAddIncidentNote)
      ? await getAiSettings()
          .then(settings => settings.enabled)
          .catch(() => false)
      : false;

  const activityContent = (
    <IncidentNotes
      incidentId={id}
      notes={incident.notes.map(note => ({
        id: note.id,
        content: note.content,
        user: note.user,
        createdAt: note.createdAt,
      }))}
      canManage={canManageIncident || canAddIncidentNote}
      onAddNote={handleAddNote}
      totalNotesCount={totalNotesCount}
      onDraftSummary={canInsertSummary ? draftIncidentSummaryNoteAction.bind(null, id) : undefined}
    />
  );

  const timelineProps = {
    incidentId: id,
    events: events.map(event => ({
      id: event.id,
      message: event.message,
      type: event.type,
      createdAt: event.createdAt,
      channel: event.channel,
    })),
    notes: incident.notes.map(note => ({
      id: note.id,
      content: note.content,
      user: note.user,
      createdAt: note.createdAt,
    })),
    notifications: incident.notifications.map(notif => ({
      id: notif.id,
      channel: notif.channel,
      status: notif.status,
      recipientDisplay: notif.recipientDisplay,
      errorMsg: redactNotificationError(notif.errorMsg),
      createdAt: notif.createdAt,
      sentAt: notif.sentAt,
      deliveredAt: notif.deliveredAt,
      failedAt: notif.failedAt,
      user: notif.user,
    })),
    incidentCreatedAt: incident.createdAt,
    incidentAcknowledgedAt: incident.acknowledgedAt,
    incidentResolvedAt: incident.resolvedAt,
    totalEventsCount: totalEventsCount,
    totalNotesCount: totalNotesCount,
    totalNotificationsCount: totalNotificationsCount,
    totalActivityCount: totalActivityCount,
    alertTotal,
    renderedAt: new Date(),
  };
  // Intelligence events join the core timeline once read; until then (and on any failure) the core
  // timeline renders on its own.
  const timelineContent = showIntelligence ? (
    <Suspense fallback={<IncidentTimeline {...timelineProps} />}>
      <IncidentTimelineWithIntelligence {...timelineProps} />
    </Suspense>
  ) : (
    <IncidentTimeline {...timelineProps} />
  );

  const responseContent = (
    <IncidentResponseTimeline
      timeline={responseTimeline}
      timeZone={userTimeZone}
      compact={presentation === 'mobile'}
    />
  );

  const automationContent = canReadAutomation ? (
    <div id="automation-decision" className="scroll-mt-24 space-y-4">
      <IncidentAutomationCard incidentId={id} />
    </div>
  ) : null;

  const escalationInBand =
    presentation !== 'mobile' && Boolean(escalationHealth) && !escalationHealth?.needsAttention;
  const contextContent =
    responseTimeline && responseTimeline.context.visibility !== 'HIDDEN' ? (
      <IncidentContextCard context={responseTimeline.context} embedded />
    ) : null;

  // Assignee and incident-role pickers offer only people who may be paged (no stakeholders).
  const pageableUsers = users.filter(candidate => isPageableRole(candidate.role));

  const postmortemContent = (
    <IncidentPostmortemTabContent
      incidentId={id}
      incidentStatus={incident.status}
      canManage={canManageIncident}
      eventCount={events.length}
      noteCount={incident.notes.length}
      users={users}
      postmortem={postmortem}
      jiraCapability={incidentJiraCapability}
      incidentJiraIssues={incidentJiraIssues}
    />
  );

  const watchersCard = (
    <IncidentWatchers
      watchers={incident.watchers.map(watcher => ({
        id: watcher.id,
        user: watcher.user,
        role: watcher.role,
      }))}
      users={users}
      canManage={canManageIncident}
      currentUserId={user.id}
      onAddWatcher={handleAddWatcher}
      onRemoveWatcher={handleRemoveWatcher}
    />
  );
  // Suggested responders sit with the responders card; only people who can add responders see them.
  const watchersContent = (
    <div id="incident-subscribers" className="scroll-mt-24 space-y-3">
      {watchersCard}
      {canManageIncident && (
        <Suspense fallback={null}>
          <IncidentExperts incidentId={id} viewerId={user.id} onAddWatcher={handleAddWatcher} />
        </Suspense>
      )}
    </div>
  );

  // Compact rows for "Catch me up", from data the page already loaded (no extra queries).
  const catchUpItems: CatchUpItem[] = [
    ...events.map(event => ({
      at: event.createdAt.toISOString(),
      kind: catchUpKind(event.type ?? '', event.message ?? ''),
      text: (event.message ?? '').slice(0, 160),
    })),
    ...incident.notes.map(note => ({
      at: note.createdAt.toISOString(),
      kind: 'note' as const,
      text: note.content.slice(0, 160),
    })),
    ...incident.notifications.map(notification => ({
      at: (notification.failedAt ?? notification.sentAt ?? notification.createdAt).toISOString(),
      kind: notification.status === 'FAILED' ? ('page_failed' as const) : ('page' as const),
      text: `${notification.channel} ${notification.status.toLowerCase()}`,
    })),
  ];
  const summaryText = incidentSummaryText({
    title: incident.title,
    priority: incident.priority ?? null,
    status: incident.status,
    serviceName: incident.service.name,
    assigneeName: incident.assignee?.name ?? incident.team?.name ?? null,
    createdAt: incident.createdAt,
    now: pageRenderedAt,
    alertTotal: alertTotal,
    escalation: incident.escalationStatus
      ? ((
          { ESCALATING: 'escalating', COMPLETED: 'max step reached', PAUSED: 'paused' } as Record<
            string,
            string
          >
        )[incident.escalationStatus] ?? incident.escalationStatus.toLowerCase())
      : null,
    url: `${appUrl}/incidents/${id}`,
  });
  // Who else has the page open, then Follow: always in view at the top right (key resets it per incident).
  const followControl = (
    <>
      <IncidentViewers key={id} incidentId={id} currentUserId={user.id} />
      <FollowControl
        currentUserId={user.id}
        currentWatcherId={incident.watchers.find(w => w.user.id === user.id)?.id ?? null}
        followers={incident.watchers.map(w => ({
          id: w.user.id,
          name: w.user.name,
          avatarUrl: w.user.avatarUrl ?? null,
        }))}
        total={incident.watchers.length}
        onAddWatcher={handleAddWatcher}
        onRemoveWatcher={handleRemoveWatcher}
      />
    </>
  );
  const routePrefix = presentation === 'mobile' ? '/m' : '';
  const detailsProps = {
    incident,
    users: pageableUsers,
    teams,
    canManage: canManageIncident,
    routePrefix,
    baseline: serviceBaseline,
    priorityReason: priorityReason({
      priority: storedIncident.priority ?? null,
      source: storedIncident.classificationPrioritySource ?? null,
      rule: storedIncident.classificationRule ?? null,
      slaRule: storedIncident.slaPolicyRule ?? null,
    }),
    escalationHealth: escalationInBand ? (
      <EscalationExecutionHealth health={escalationHealth} variant="inline" />
    ) : null,
  };
  const detailsBand = <IncidentHeader {...detailsProps} embedded />;

  const holderByRole = new Map(
    storedIncident.roleAssignments.map(assignment => [assignment.roleKey, assignment.user])
  );
  const roleSlots: IncidentRoleSlot[] = INCIDENT_ROLES.map(role => ({
    roleKey: role.key,
    label: role.label,
    shortLabel: role.shortLabel,
    description: role.description,
    holder: holderByRole.get(role.key) ?? null,
    canAssignOthers: roleAccess?.access.canAssignOthers[role.key] ?? false,
    canTakeSelf: roleAccess?.access.canTakeSelf[role.key] ?? false,
    canClear: roleAccess?.access.canClear[role.key] ?? false,
  }));
  const handleSetRole = setIncidentDetailRole.bind(null, id);
  const impactedBusinessServices = await impactedBusinessServicesForIncident(
    await getCurrentAuthorizationActor(),
    id
  );
  const canTakeCommand =
    incident.status !== 'RESOLVED' &&
    (roleAccess?.access.canTakeSelf.COMMANDER ?? false) &&
    holderByRole.get('COMMANDER')?.id !== user.id;
  const handleTakeCommand = setIncidentDetailRole.bind(null, id, 'COMMANDER', user.id);

  const incidentUrl = `${appUrl}/incidents/${id}`;
  const postmortemHref =
    postmortem && presentation === 'mobile'
      ? `/m/postmortems/${postmortem.id}`
      : `/postmortems/${id}`;
  const shareMenu = <ShareMenu id={id} url={incidentUrl} summary={summaryText} />;
  const shareMenuIcon = <ShareMenu id={id} url={incidentUrl} summary={summaryText} iconOnly />;
  // ID, dedup and recurrence, service (phones) and age on one quiet line under the title.
  const metaLine = (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <CopyIdText id={id} />
      <DedupRecurrenceChip
        inline
        alertTotal={alertTotal}
        hasDedupKey={Boolean(storedIncident.dedupKey)}
        createdAt={incident.createdAt}
        previous={previousOnKey}
        routePrefix={routePrefix}
      />
      {presentation === 'mobile' && <span className="truncate">{incident.service.name}</span>}
      <span title={formatDateTime(incident.createdAt, userTimeZone, { format: 'datetime' })}>
        opened {formatRelativeShort(incident.createdAt, userTimeZone).toLowerCase()}
      </span>
    </p>
  );
  const statusTileClass = STATUS_TILE[statusTone ?? 'none'] ?? STATUS_TILE.none;
  const responseRow = (
    <ResponseRow
      incidentId={id}
      impacts={impactedBusinessServices}
      canEditImpacts={presentation !== 'mobile' && canManageIncident}
      linkableImpacts={presentation !== 'mobile'}
      roles={roleSlots}
      users={pageableUsers}
      currentUserId={user.id}
      onSetRole={handleSetRole}
    />
  );

  const quickLinksContent = (
    <IncidentQuickLinksCard
      incidentPolicy={incidentPolicy}
      pinnedPolicy={decision?.mode === 'LIVE'}
      noEscalation={decision?.mode === 'LIVE' && decision.routeType === 'NO_ESCALATION'}
      service={{
        id: incident.service.id,
        name: incident.service.name,
        status: incident.service.status,
        slaTier: incident.service.slaTier,
        policy: incident.service.policy
          ? { id: incident.service.policy.id, name: incident.service.policy.name }
          : null,
      }}
      team={incident.team ? { id: incident.team.id, name: incident.team.name } : null}
      routePrefix={routePrefix}
      embedded
    />
  );

  const customFieldsEmbedded = (
    <IncidentCustomFieldsCard
      incidentId={id}
      customFieldValues={
        incident.customFieldValues?.map(value => ({
          id: value.id,
          value: value.value,
          customField: value.customField,
        })) || []
      }
      allCustomFields={customFields}
      canManage={canManageIncident}
      embedded
    />
  );
  // The rest of Details: who subscribes (opens the sheet) and the links not already on a field row.
  const moreDetailsRows = <>{quickLinksContent}</>;
  const detailsPanelFull = (
    <IncidentHeader
      {...detailsProps}
      panel
      headerAction={
        canManageIncident ? (
          <Link
            href="/settings/custom-fields"
            title="Configure custom fields"
            aria-label="Configure custom fields"
            className="-my-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null
      }
      footer={
        <>
          {customFieldsEmbedded}
          {moreDetailsRows}
        </>
      }
    />
  );

  const descriptionContent = sourceRestricted ? (
    <section className="rounded-xl border border-border/80 bg-card p-3.5 text-card-foreground">
      <h2 className="text-xs font-semibold">Incident Description</h2>
      <p className="mt-1 text-xs text-muted-foreground">Alert details are restricted.</p>
      {contextContent && (
        <div className="mt-3 border-t border-border/70 pt-3">{contextContent}</div>
      )}
    </section>
  ) : (
    <IncidentDescriptionCard
      incidentId={incident.id}
      description={incident.description}
      canManage={canManageIncident}
      onUpdateDescription={handleUpdateDescription}
      context={contextContent}
      readable={incident.description ? readPayload(incident.description) : null}
      clamp
    />
  );
  const customerCommsCard = (
    <Suspense fallback={<CardSkeleton title="Customer updates" rows={2} />}>
      <IncidentCustomerCommsCard
        incident={{
          id,
          serviceId: storedIncident.serviceId,
          status: storedIncident.status,
          visibility: storedIncident.visibility,
        }}
        timeZone={userTimeZone}
      />
    </Suspense>
  );
  const tabsProps = {
    eventCount: totalEventsCount,
    noteCount: totalNotesCount,
    activityContent,
    automationContent,
    responseContent,
    auditContent: <IncidentAuditView incidentId={incident.id} />,
    alertsContent:
      alertTotal > 0 ? (
        <IncidentAlertsView incidentId={incident.id} total={alertTotal} />
      ) : undefined,
    runbooksContent: canReadRunbooks ? (
      <>
        {showIntelligence && (
          <Suspense fallback={null}>
            <SuggestedRunbooks incidentId={incident.id} />
          </Suspense>
        )}
        <IncidentRunbooks incidentId={incident.id} serviceId={incident.serviceId} />
      </>
    ) : null,
    timelineContent,
    postmortemContent,
    postmortemStatus: postmortem?.status ?? null,
    showPostmortem: incident.status === 'RESOLVED',
  };

  return (
    <div
      className={
        presentation === 'mobile'
          ? 'incident-dense responsive-page w-full space-y-3 pb-24'
          : 'incident-dense responsive-page w-full space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6'
      }
    >
      {presentation === 'mobile' ? (
        <section className="rounded-xl border border-border bg-card text-card-foreground">
          {/* The mobile header already has the back arrow, so the card starts with status and title. */}
          <div className="space-y-3 p-3.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <IncidentStatusBadge status={incident.status} />
                <IncidentUrgencyBadge urgency={incident.urgency} />
                {incident.priority && (
                  <Badge variant="outline" className="h-5 px-1.5 text-2xs font-bold">
                    {incident.priority}
                  </Badge>
                )}
              </div>
              {shareMenuIcon}
            </div>
            <div className="space-y-1">
              <h1 className="wrap-break-word font-display text-lg font-bold leading-snug tracking-tight text-foreground">
                {incident.title}
              </h1>
              {metaLine}
            </div>
            {showIntelligence && (
              <Suspense fallback={null}>
                <IncidentGroupLine incidentId={incident.id} presentation="mobile" />
              </Suspense>
            )}
            <IncidentSLABadges sla={incidentSla} className="pt-0" compact />
            <div className="flex flex-wrap items-center gap-2.5">{followControl}</div>
            <div className="flex min-w-0 items-center gap-1.5 border-t border-border/70 pt-3 text-xs">
              <span className="shrink-0 text-muted-foreground">Assigned</span>
              {incident.assignee && (
                <UserAvatar
                  userId={incident.assignee.id}
                  avatarUrl={incident.assignee.avatarUrl}
                  name={incident.assignee.name}
                  gender={incident.assignee.gender}
                  size="xs"
                  aria-hidden
                />
              )}
              <span className="truncate font-semibold text-foreground">
                {incident.assignee?.name || 'Unassigned'}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">{responseRow}</div>
          </div>
        </section>
      ) : (
        <section className="relative rounded-2xl border border-border bg-card text-card-foreground shadow-2xs">
          <div className="p-3.5 sm:px-4.5 sm:py-4">
            <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
              <ListReturnLink
                href={backHref}
                aria-label={backLabel}
                title={backLabel}
                className="mt-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </ListReturnLink>
              {/* One soft status tile; the badge beside the title says the status in words. */}
              <div
                aria-hidden
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset sm:h-10 sm:w-10 ${statusTileClass}`}
              >
                {incident.status === 'RESOLVED' ? (
                  <CheckCircle2 className="h-4.5 w-4.5" />
                ) : incident.status === 'SNOOZED' ? (
                  <Pause className="h-4.5 w-4.5" />
                ) : incident.status === 'SUPPRESSED' ? (
                  <Volume2 className="h-4.5 w-4.5" />
                ) : (
                  <AlertCircle className="h-4.5 w-4.5" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                {/* Narrow windows stack the actions under the title instead of squeezing it to one letter wide. */}
                <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between">
                  <div className="min-w-0 space-y-1 pt-0.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                      <h1
                        className={`min-w-0 wrap-break-word text-lg font-bold leading-snug tracking-tight text-foreground ${
                          // Long titles step down a size so they stay ~3 lines instead of 4+.
                          incident.title.length > 80 ? 'sm:text-xl' : 'sm:text-2xl'
                        }`}
                      >
                        {incident.title}
                      </h1>
                      <StatusBadge
                        status={incident.status}
                        live={incident.status === 'OPEN'}
                        // The page's chip shape (field-styles CHIP_CLASS); other pages keep the pill.
                        className="h-8 rounded-md px-2.5 text-xs shadow-2xs"
                      />
                    </div>
                    {metaLine}
                  </div>
                  {/* Who's viewing, Follow / Following with who follows, and Share: always in view. */}
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {followControl}
                    {shareMenu}
                  </div>
                </div>
                {showIntelligence && (
                  <Suspense fallback={null}>
                    <IncidentGroupLine incidentId={incident.id} />
                  </Suspense>
                )}
                {/* Response row: SLA, impact and roles, right under the title. */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2.5">
                  <IncidentSLABadges sla={incidentSla} className="pt-0" />
                  {responseRow}
                  {(canManageIncident || canAddIncidentNote) && (
                    <NotifyStakeholdersButton
                      incidentId={incident.id}
                      incidentStatus={incident.status}
                      businessServices={impactedBusinessServices.filter(impact => !impact.excluded)}
                    />
                  )}
                  <Link
                    href={`/services/graph?incident=${encodeURIComponent(incident.id)}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs font-medium text-foreground shadow-2xs hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Network className="h-3.5 w-3.5" aria-hidden="true" />
                    Show on graph
                  </Link>
                </div>
              </div>
            </div>
          </div>
          {/* Below lg the side column drops under the tabs, so the details stay in the card there. */}
          <div className="lg:hidden">{detailsBand}</div>
        </section>
      )}

      {/* A, R, W, T, S on the incident page (listed in the ? shortcuts overlay). */}
      <IncidentShortcuts summary={summaryText} />
      {/* Refreshes when someone else changes this incident: shared realtime connection, throttled. */}
      <IncidentLiveRefresh incidentId={incident.id} />

      {/* "Since you looked 2h ago: …" — remembered per incident in the viewer's browser; nothing on a first visit. */}
      <CatchUpStrip incidentId={incident.id} items={catchUpItems} />

      {/* AI briefing: one compact card under the title card, so it is read first without pushing the rest down. */}
      {presentation !== 'mobile' && showInsightsInspector && (
        <Suspense fallback={null}>
          <IncidentInsights incidentId={incident.id} presentation={presentation} variant="card" />
        </Suspense>
      )}

      {storedIncident.maintenanceWindow && incident.status === 'SUPPRESSED' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-status-info-border bg-status-info-soft px-4 py-2.5 text-sm text-status-info-deep"
        >
          <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Held by maintenance window{' '}
            <Link
              href={
                presentation === 'mobile'
                  ? `/m/services/${incident.serviceId}`
                  : `/services/${incident.serviceId}?tab=maintenance`
              }
              className={`font-semibold underline-offset-2 hover:underline ${
                presentation === 'mobile' ? '-my-3 inline-block py-3 underline' : ''
              }`}
            >
              {storedIncident.maintenanceWindow.title}
            </Link>
            . Nobody is paged until it ends (
            {formatDateTime(storedIncident.maintenanceWindow.endsAt, userTimeZone, {
              format: 'datetime',
            })}
            ).
          </span>
        </div>
      )}

      {/* Command Bar: Responders need immediate access to Acknowledge / Resolve */}
      <IncidentCommandBar
        incidentId={incident.id}
        currentStatus={incident.status}
        canManage={canManageIncident}
        canAcknowledge={canManageIncident || canAcknowledgeIncident}
        canResolve={canManageIncident || canResolveIncident}
        canTakeCommand={canTakeCommand}
        onTakeCommand={handleTakeCommand}
        snoozedUntil={incident.snoozedUntil}
        onAcknowledge={handleAcknowledge}
        onUnacknowledge={handleReopen}
        onUnsnooze={handleReopen}
        onSuppress={handleSuppress}
        onUnsuppress={handleReopen}
        resolvingIncident={{
          id: incident.id,
          title: incident.title,
          service: { name: incident.service.name },
          priority: incident.priority ?? null,
          // Only people who may write the postmortem are offered to start it.
          postmortemHref: canManageIncident ? `/postmortems/${incident.id}` : null,
        }}
        postmortemHref={postmortemHref}
        postmortemExists={Boolean(postmortem)}
        collaboration={collaboration}
        jira={{
          links: jiraLinks,
          enabled: incidentJiraCapability.rawEnabled,
          serviceMapped: Boolean(incident.service.jiraServiceMapping?.projectKey),
          serviceSettingsHref: `/services/${incident.serviceId}/settings`,
        }}
        tags={incident.tags.map(tagLink => ({
          id: tagLink.tag.id,
          name: tagLink.tag.name,
          color: tagLink.tag.color,
        }))}
        jiraCapability={incidentJiraCapability}
        statusUpdate={
          statusUpdate && {
            href: `/settings/status-pages/${statusUpdate.statusPageId}?announce=${encodeURIComponent(id)}`,
            statusPageName: statusUpdate.statusPageName,
            nextDueAt: statusUpdate.nextDueAt?.toISOString() ?? null,
          }
        }
      />

      {presentation === 'mobile' ? (
        // Phones: the page splits into five short sections under one sticky bar instead of one long scroll.
        <IncidentDetailTabs
          layout="sections"
          defaultTab={initialTab || 'overview'}
          overviewContent={
            <>
              {showInsightsInspector && (
                <Suspense fallback={null}>
                  <IncidentInsights incidentId={incident.id} presentation={presentation} />
                </Suspense>
              )}
              {incident.status === 'RESOLVED' && (
                <IncidentResolutionSummary
                  incident={incident}
                  resolutionNote={resolutionNote}
                  postmortemStatus={postmortem?.status ?? null}
                  postmortemHref={postmortemHref}
                />
              )}

              <EscalationExecutionHealth health={escalationHealth} />
              <Suspense fallback={<CardSkeleton title="Responders" rows={4} />}>
                <IncidentRespondersCard incidentId={id} viewerId={user.id} />
              </Suspense>
              {customerCommsCard}
              {watchersContent}
              {descriptionContent}
            </>
          }
          detailsContent={
            <>
              {detailsPanelFull}
              <MobileOperationalContextCard
                service={{
                  id: incident.service.id,
                  name: incident.service.name,
                  slaTier: incident.service.slaTier,
                }}
                team={incident.team ? { id: incident.team.id, name: incident.team.name } : null}
                tags={incident.tags.map(tagLink => ({
                  id: tagLink.tag.id,
                  name: tagLink.tag.name,
                  color: tagLink.tag.color,
                }))}
                collaboration={collaboration}
                jiraLinks={jiraLinks.map(l => ({
                  id: l.id,
                  issueKey: l.externalKey,
                  issueUrl: l.externalUrl,
                  status: l.externalStatus ?? undefined,
                }))}
                capabilities={{
                  jiraConfigured: jiraLinks.length > 0,
                }}
                showServiceTeam={false}
              />
            </>
          }
          {...tabsProps}
        />
      ) : (
        <>
          {/* Healthy: one line under the Escalation field; the full panel when a step needs review. */}
          <EscalationExecutionHealth
            health={escalationHealth}
            className={escalationInBand ? 'sm:hidden' : undefined}
          />
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
            <div className="min-w-0 space-y-4 lg:col-span-8 lg:space-y-5 2xl:col-span-9">
              {descriptionContent}
              {incident.status === 'RESOLVED' && (
                <IncidentResolutionSummary
                  incident={incident}
                  resolutionNote={resolutionNote}
                  postmortemStatus={postmortem?.status ?? null}
                  postmortemHref={postmortemHref}
                />
              )}

              <IncidentDetailTabs defaultTab={initialTab || 'notes'} {...tabsProps} />
            </div>
            <aside className="min-w-0 space-y-4 lg:col-span-4 lg:space-y-5 2xl:col-span-3">
              <div className="hidden lg:block">{detailsPanelFull}</div>
              {/* Below lg the properties sit in the title card; the rest of Details gets its own card. */}
              <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-2xs lg:hidden">
                {customFieldsEmbedded}
                {moreDetailsRows}
              </div>
              {/* Who gets this incident's updates: always in view, with Subscribe / Add inline. */}
              {watchersContent}
              {/* Who was paged, how, did it arrive, who acknowledged; escalation now; on call. */}
              <Suspense fallback={<CardSkeleton title="Responders" rows={4} />}>
                <IncidentRespondersCard incidentId={id} viewerId={user.id} />
              </Suspense>
              {/* What customers were told, and when the next update is due. */}
              {customerCommsCard}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

async function loadPreviousOnDedupKey(
  incidentId: string,
  dedupKey: string | null,
  createdAt: Date
) {
  if (!dedupKey) return null;
  try {
    const readable = incidentReadWhere(await getCurrentAuthorizationActor());
    return await prisma.incident.findFirst({
      where: {
        AND: [{ dedupKey, id: { not: incidentId }, createdAt: { lt: createdAt } }, readable],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, createdAt: true },
    });
  } catch {
    // A recurrence hint must never block the incident page.
    return null;
  }
}
