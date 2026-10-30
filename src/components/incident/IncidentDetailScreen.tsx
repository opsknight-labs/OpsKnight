import IncidentIntelligencePanel from './IncidentIntelligencePanel';
import IntelligenceSkeleton from './IntelligenceSkeleton';
import prisma from '@/lib/prisma';
import { Suspense } from 'react';
import IncidentAutomationCard from '@/components/automation/IncidentAutomationCard';
import IncidentIntelligenceCard from '@/components/incident/IncidentIntelligenceCard';
import IncidentRelatedCard from '@/components/incident/IncidentRelatedCard';
import IncidentResponseCard from '@/components/incident/IncidentResponseCard';
import IncidentAskSquireCard from '@/components/squire/IncidentAskSquireCard';
import IncidentAiSummaryCard from '@/components/incident/IncidentAiSummaryCard';
import EscalationExecutionHealth from '@/components/incident/detail/EscalationExecutionHealth';
import { getEscalationExecutionHealth } from '@/lib/escalation/execution-health';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';
import { CAPABILITIES } from '@/lib/authorization';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCanViewIncident, getUserPermissions } from '@/lib/rbac';
import { getPostmortem } from '@/app/(app)/postmortems/actions';
import IncidentHeader from '@/components/incident/IncidentHeader';
import IncidentWatchers from '@/components/incident/detail/IncidentWatchers';
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
import { getUserTimeZone } from '@/lib/timezone';
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
  suppressIncidentDetail,
  updateIncidentDetailDescription,
} from '@/components/incident/detail/actions';
import { projectIncidentSlaState } from '@/lib/incident-sla/state';
import { Badge } from '@/components/ui/shadcn/badge';
import CopyButton from '@/components/common/CopyButton';
import { getAppUrl } from '@/lib/app-url';
import { redactNotificationError } from '@/lib/notification-operations';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, Pause, Volume2 } from 'lucide-react';
import { getJiraCapabilities } from '@/lib/jira-capabilities';
import { serializeJiraIssueReference } from '@/lib/jira-references';
import { getIncidentCollaborationView } from '@/lib/incident-collaboration/get-incident-collaboration';

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
export default async function IncidentDetailScreen({
  id,
  backHref,
  backLabel = 'Back to Incidents',
  presentation = 'desktop',
  initialTab,
}: IncidentDetailScreenProps) {
  const user = await assertCanViewIncident(id);
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
      assignee: true,
      team: true,
      events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 },
      notes: {
        include: { user: true },
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
      watchers: { include: { user: true }, orderBy: { createdAt: 'asc' } },
      tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
      customFieldValues: { include: { customField: true } },
    },
  });

  if (!storedIncident) notFound();
  const permissions = await getUserPermissions();
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
    incidentPolicy,
    noEscalation: decision?.mode === 'LIVE' && decision.routeType === 'NO_ESCALATION',
  };
  const incidentSla = projectIncidentSlaState(incident, { now: new Date() });
  const canReadRunbooks =
    permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_ALL) ||
    permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_SCOPED);
  const canManageIncident = permissions.isResponderOrAbove;
  const canAcknowledgeIncident = permissions.capabilities.includes('incident.acknowledge.scoped');
  const canAddIncidentNote = permissions.capabilities.includes('incident.note.scoped');
  const canReadAutomation =
    permissions.capabilities.includes(CAPABILITIES.AUTOMATION_READ) &&
    !!storedIncident.automationDecision;

  const [users, teams, customFields, totalEventsCount, totalNotesCount, totalNotificationsCount] =
    await Promise.all([
      canManageIncident
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
      canManageIncident ? prisma.team.findMany({ orderBy: { name: 'asc' } }) : Promise.resolve([]),
      prisma.customField.findMany({ orderBy: { order: 'asc' } }),
      prisma.incidentEvent.count({ where: { incidentId: id } }),
      prisma.incidentNote.count({ where: { incidentId: id } }),
      prisma.notification.count({ where: { incidentId: id } }),
    ]);

  const totalActivityCount = totalEventsCount + totalNotesCount + totalNotificationsCount;

  const incidentJiraCapability = await getJiraCapabilities({
    serviceId: incident.serviceId,
    canManage: canManageIncident,
  });
  const postmortem = incident.status === 'RESOLVED' ? await getPostmortem(id) : null;

  // Rendering an incident must not perform hidden Jira or provider network I/O.
  // Persisted state is refreshed by background webhooks or explicit sync actions.
  const [jiraLinks, collaboration, escalationHealth] = await Promise.all([
    prisma.externalIssueLink.findMany({
      where: { incidentId: id, provider: 'JIRA' },
      orderBy: { createdAt: 'desc' },
    }),
    getIncidentCollaborationView({ incidentId: id, userId: user.id }),
    // A health read failure must not block the incident page.
    getEscalationExecutionHealth(id).catch(() => null),
  ]);

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
  const handleReopen = reopenIncidentDetail.bind(null, id);
  const handleSuppress = suppressIncidentDetail.bind(null, id);
  const handleAddWatcher = addIncidentDetailWatcher.bind(null, id);
  const handleRemoveWatcher = removeIncidentDetailWatcher.bind(null, id);
  const handleUpdateDescription = updateIncidentDetailDescription.bind(null, id);

  const statusGradient = (() => {
    switch (incident.status) {
      case 'RESOLVED':
        return 'from-green-600 to-emerald-700';
      case 'ACKNOWLEDGED':
        return 'from-amber-500 to-orange-600';
      case 'SNOOZED':
        return 'from-indigo-500 to-purple-600';
      case 'SUPPRESSED':
        return 'from-gray-500 to-slate-600';
      default:
        return 'from-red-600 to-rose-700';
    }
  })();

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
    />
  );

  const timelineContent = (
    <IncidentTimeline
      incidentId={id}
      events={incident.events.map(event => ({
        id: event.id,
        message: event.message,
        type: event.type,
        createdAt: event.createdAt,
      }))}
      notes={incident.notes.map(note => ({
        id: note.id,
        content: note.content,
        user: note.user,
        createdAt: note.createdAt,
      }))}
      notifications={incident.notifications.map(notif => ({
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
      }))}
      incidentCreatedAt={incident.createdAt}
      incidentAcknowledgedAt={incident.acknowledgedAt}
      incidentResolvedAt={incident.resolvedAt}
      totalEventsCount={totalEventsCount}
      totalNotesCount={totalNotesCount}
      totalNotificationsCount={totalNotificationsCount}
      totalActivityCount={totalActivityCount}
    />
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

  const contextContent = responseTimeline ? (
    <IncidentContextCard context={responseTimeline.context} />
  ) : null;
  const hasContextCard = !!responseTimeline && responseTimeline.context.visibility !== 'HIDDEN';

  const postmortemContent = (
    <IncidentPostmortemTabContent
      incidentId={id}
      incidentStatus={incident.status}
      canManage={canManageIncident}
      eventCount={incident.events.length}
      noteCount={incident.notes.length}
      users={users}
      postmortem={postmortem}
      jiraCapability={incidentJiraCapability}
      incidentJiraIssues={incidentJiraIssues}
    />
  );

  const watchersContent = (
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

  const customFieldsContent = (
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
    />
  );

  const routePrefix = presentation === 'mobile' ? '/m' : '';

  const quickLinksContent = (
    <IncidentQuickLinksCard
      incidentId={incident.id}
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
    />
  );

  return (
    <div
      className={
        presentation === 'mobile'
          ? 'responsive-page w-full space-y-3 pb-24'
          : 'responsive-page w-full space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6'
      }
    >
      {presentation === 'mobile' ? (
        <section className="rounded-xl border border-border bg-card p-3.5 text-card-foreground shadow-none">
          <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-border/70 pb-2">
            <Link
              href={backHref}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{backLabel}</span>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <CopyButton text={id} label="ID" className="h-7 px-2 text-[10px]" />
              <CopyButton
                text={`${appUrl}/incidents/${id}`}
                icon="link"
                label="Link"
                className="h-7 px-2 text-[10px]"
              />
            </div>
          </div>

          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <IncidentStatusBadge status={incident.status} />
                <IncidentUrgencyBadge urgency={incident.urgency} />
                {incident.priority && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-bold">
                    {incident.priority}
                  </Badge>
                )}
              </div>
              <h1 className="mt-2 break-words text-base font-bold leading-snug tracking-tight text-foreground">
                {incident.title}
              </h1>
            </div>
          </div>

          <div className="mt-3">
            <IncidentSLABadges sla={incidentSla} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-[11px]">
            <div className="min-w-0">
              <span className="block text-muted-foreground">Service</span>
              <span className="mt-0.5 block truncate font-semibold text-foreground">
                {incident.service.name}
              </span>
            </div>
            <div className="min-w-0">
              <span className="block text-muted-foreground">Assigned to</span>
              <span className="mt-0.5 block truncate font-semibold text-foreground">
                {incident.assignee?.name || 'Unassigned'}
              </span>
            </div>
          </div>
        </section>
      ) : (
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xs">
          <div className={`h-1 w-full bg-gradient-to-r ${statusGradient}`} />
          <div className="p-3.5 sm:p-4.5">
            <div className="mb-2.5 flex min-w-0 items-center justify-between gap-3">
              <Link
                href={backHref}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{backLabel}</span>
              </Link>
              <div className="flex min-w-0 items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="hidden font-mono text-[11px] text-muted-foreground sm:inline-flex border-border/80"
                >
                  #{id.slice(0, 8)}
                </Badge>
                <CopyButton text={id} label="ID" className="h-7 px-2 text-xs font-medium" />
                <CopyButton
                  text={`${appUrl}/incidents/${id}`}
                  icon="link"
                  label="Link"
                  className="h-7 px-2 text-xs font-medium"
                />
              </div>
            </div>

            <div className="flex min-w-0 items-start gap-3 sm:gap-3.5">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm sm:h-10 sm:w-10 ${statusGradient}`}
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
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="min-w-0 break-words text-base font-bold leading-snug tracking-tight text-foreground sm:text-xl">
                    {incident.title}
                  </h1>
                  <Badge
                    className={`shrink-0 border-0 bg-gradient-to-r text-[11px] font-bold text-white shadow-2xs ${statusGradient}`}
                  >
                    {incident.status}
                  </Badge>
                </div>
                <IncidentSLABadges sla={incidentSla} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Command Bar: Responders need immediate access to Acknowledge / Resolve */}
      <IncidentCommandBar
        incidentId={incident.id}
        currentStatus={incident.status}
        canManage={canManageIncident}
        canAcknowledge={canManageIncident || canAcknowledgeIncident}
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
        }}
        postmortemHref={
          postmortem
            ? presentation === 'mobile'
              ? `/m/postmortems/${postmortem.id}`
              : `/postmortems/${id}`
            : `/postmortems/${id}`
        }
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
      />

      {/* Escalation Execution Health: Compact status strip or alert banner */}
      <EscalationExecutionHealth health={escalationHealth} />

      {presentation === 'mobile' ? (
        <details className="group overflow-hidden rounded-xl border border-border bg-card">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2 text-xs font-semibold text-foreground select-none [&>*]:pointer-events-none [&::-webkit-details-marker]:hidden">
            <span>Incident details &amp; assignment</span>
            <ChevronDown
              className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="border-t border-border p-2">
            <IncidentHeader
              incident={incident}
              users={users}
              teams={teams}
              canManage={canManageIncident}
              routePrefix={routePrefix}
            />
          </div>
        </details>
      ) : (
        <IncidentHeader
          incident={incident}
          users={users}
          teams={teams}
          canManage={canManageIncident}
          routePrefix={routePrefix}
        />
      )}

      {presentation === 'mobile' && (
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
        />
      )}

      {/* Main Content Grid: 2 columns on desktop, responsive stack on mobile */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="min-w-0 space-y-4 lg:col-span-8 lg:space-y-5 2xl:col-span-9">
          {sourceRestricted ? (
            <section className="rounded-xl border border-border/80 bg-card p-3.5 text-card-foreground">
              <h2 className="text-xs font-semibold">Incident Description</h2>
              <p className="mt-1 text-xs text-muted-foreground">Alert details are restricted.</p>
            </section>
          ) : (
            <IncidentDescriptionCard
              incidentId={incident.id}
              description={incident.description}
              canManage={canManageIncident}
              onUpdateDescription={handleUpdateDescription}
            />
          )}

          {incident.status === 'RESOLVED' && (
            <IncidentResolutionSummary
              incident={incident}
              resolutionNote={resolutionNote}
              postmortemStatus={postmortem?.status ?? null}
              canManage={canManageIncident}
            />
          )}

          <IncidentIntelligencePanel
            similar={
              <Suspense fallback={<IntelligenceSkeleton />}>
                <IncidentIntelligenceCard incidentId={incident.id} />
              </Suspense>
            }
            related={
              <Suspense fallback={<IntelligenceSkeleton />}>
                <IncidentRelatedCard incidentId={incident.id} />
              </Suspense>
            }
            response={
              <Suspense fallback={<IntelligenceSkeleton />}>
                <IncidentResponseCard incidentId={incident.id} />
              </Suspense>
            }
            summary={
              <Suspense fallback={<IntelligenceSkeleton />}>
                <IncidentAiSummaryCard incidentId={incident.id} />
              </Suspense>
            }
            assistant={
              <Suspense fallback={<IntelligenceSkeleton />}>
                <IncidentAskSquireCard />
              </Suspense>
            }
          />

          <IncidentDetailTabs
            defaultTab={initialTab || 'overview'}
            eventCount={totalEventsCount}
            noteCount={totalNotesCount}
            activityContent={activityContent}
            automationContent={automationContent}
            responseContent={responseContent}
            runbooksContent={
              canReadRunbooks ? (
                <IncidentRunbooks incidentId={incident.id} serviceId={incident.serviceId} />
              ) : null
            }
            timelineContent={timelineContent}
            postmortemContent={postmortemContent}
            postmortemStatus={postmortem?.status ?? null}
          />
        </div>

        {presentation === 'mobile' ? (
          <>
            {hasContextCard && (
              <details className="group overflow-hidden rounded-xl border border-border bg-card">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2 text-xs font-semibold text-foreground select-none [&>*]:pointer-events-none [&::-webkit-details-marker]:hidden">
                  <span>Incident context</span>
                  <ChevronDown
                    className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="border-t border-border p-2">{contextContent}</div>
              </details>
            )}
            <details className="group overflow-hidden rounded-xl border border-border bg-card lg:hidden">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2 text-xs font-semibold text-foreground select-none [&>*]:pointer-events-none [&::-webkit-details-marker]:hidden">
                <span>People, fields &amp; links</span>
                <ChevronDown
                  className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-3 border-t border-border p-3">
                {watchersContent}
                {customFieldsContent}
                {quickLinksContent}
              </div>
            </details>
            <aside className="hidden min-w-0 space-y-4 lg:block lg:col-span-4 lg:space-y-5 2xl:col-span-3">
              {contextContent}
              {watchersContent}
              {customFieldsContent}
              {quickLinksContent}
            </aside>
          </>
        ) : (
          <aside className="min-w-0 space-y-4 lg:col-span-4 lg:space-y-5 2xl:col-span-3">
            {contextContent}
            {watchersContent}
            {customFieldsContent}
            {quickLinksContent}
          </aside>
        )}
      </div>
    </div>
  );
}
