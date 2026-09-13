import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCanViewIncident, getUserPermissions } from '@/lib/rbac';
import { getPostmortem } from '@/app/(app)/postmortems/actions';
import IncidentHeader from '@/components/incident/IncidentHeader';
import IncidentWatchers from '@/components/incident/detail/IncidentWatchers';
import IncidentCommandBar from '@/components/incident/detail/IncidentCommandBar';
import IncidentDetailTabs from '@/components/incident/IncidentDetailTabs';
import IncidentNotes from '@/components/incident/detail/IncidentNotes';
import IncidentTimeline from '@/components/incident/detail/IncidentTimeline';
import IncidentResolutionSummary from '@/components/incident/detail/IncidentResolutionSummary';
import IncidentPostmortemTabContent from '@/components/incident/detail/IncidentPostmortemTabContent';
import IncidentDescriptionCard from '@/components/incident/detail/IncidentDescriptionCard';
import IncidentSLABadges from '@/components/incident/detail/IncidentSLABadges';
import IncidentCustomFieldsCard from '@/components/incident/detail/IncidentCustomFieldsCard';
import IncidentQuickLinksCard from '@/components/incident/detail/IncidentQuickLinksCard';
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
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, Pause, Volume2 } from 'lucide-react';
import { getJiraCapabilities } from '@/lib/jira-capabilities';
import { serializeJiraIssueReference } from '@/lib/jira-references';
import MicrosoftTeamsWarRoomsPanel from '@/components/incident/detail/MicrosoftTeamsWarRoomsPanel';
import { getMicrosoftTeamsCapabilities } from '@/lib/microsoft-teams/capabilities';

export type IncidentDetailScreenProps = {
  id: string;
  backHref: string;
  backLabel?: string;
  presentation?: 'desktop' | 'mobile';
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
}: IncidentDetailScreenProps) {
  const user = await assertCanViewIncident(id);
  const appUrl = await getAppUrl();
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
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
      events: { orderBy: { createdAt: 'desc' } },
      notes: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      watchers: { include: { user: true }, orderBy: { createdAt: 'asc' } },
      tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
      customFieldValues: { include: { customField: true } },
    },
  });

  if (!incident) notFound();

  const incidentSla = projectIncidentSlaState(incident, { now: new Date() });

  const permissions = await getUserPermissions();
  const canManageIncident = permissions.isResponderOrAbove;
  const canAcknowledgeIncident = permissions.capabilities.includes('incident.acknowledge.scoped');
  const canAddIncidentNote = permissions.capabilities.includes('incident.note.scoped');

  const [users, teams, customFields] = await Promise.all([
    canManageIncident
      ? prisma.user.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, email: true, avatarUrl: true, gender: true, role: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    canManageIncident ? prisma.team.findMany({ orderBy: { name: 'asc' } }) : Promise.resolve([]),
    prisma.customField.findMany({ orderBy: { order: 'asc' } }),
  ]);

  const incidentJiraCapability = await getJiraCapabilities({
    serviceId: incident.serviceId,
    canManage: canManageIncident,
  });
  const postmortem = incident.status === 'RESOLVED' ? await getPostmortem(id) : null;

  // Rendering an incident must not perform hidden Jira network I/O. Persisted
  // state is refreshed by authenticated webhooks or explicit sync actions.
  const [jiraLinks, chatOpsConfig, globalSlackIntegration, teamsWarRooms, teamsWarRoomDestination] =
    await Promise.all([
      prisma.externalIssueLink.findMany({
        where: { incidentId: id, provider: 'JIRA' },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.chatOpsConfig.findUnique({
        where: { id: 'default' },
        select: { enabled: true },
      }),
      prisma.slackIntegration.findFirst({
        where: { enabled: true, services: { none: {} } },
        select: { workspaceId: true },
      }),
      prisma.incidentWarRoom.findMany({
        where: { incidentId: id, provider: 'MICROSOFT_TEAMS' },
        orderBy: { generation: 'desc' },
        select: {
          id: true,
          generation: true,
          state: true,
          providerChannelName: true,
          providerChannelUrl: true,
          membershipType: true,
          lastError: true,
          participants: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              source: true,
              state: true,
              lastError: true,
              user: { select: { name: true } },
            },
          },
        },
      }),
      prisma.microsoftTeamsDestination.findFirst({
        where: {
          serviceId: incident.serviceId,
          enabled: true,
          warRoomEnabled: true,
          installation: { is: { enabled: true } },
        },
        select: { tenantId: true, teamId: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

  const teamsWarRoomCapability = teamsWarRoomDestination
    ? await getMicrosoftTeamsCapabilities({
        tenantId: teamsWarRoomDestination.tenantId,
        teamId: teamsWarRoomDestination.teamId,
      }).catch(() => null)
    : null;
  const teamsWarRoomEnabled = Boolean(teamsWarRoomCapability?.canCreateWarRooms);
  const teamsWarRoomUnavailableReason = teamsWarRoomDestination
    ? (teamsWarRoomCapability?.failureReason ??
      'Teams war-room capability could not be verified for the configured Team.')
    : 'Map this service to an installed Teams destination with war rooms enabled.';

  const incidentJiraIssues = jiraLinks.map(serializeJiraIssueReference);
  const hasSlackWorkspace = Boolean(
    (incident.service.slackIntegration?.workspaceId &&
      incident.service.slackIntegration?.enabled !== false) ||
    globalSlackIntegration?.workspaceId
  );
  const isWarRoomEnabled = Boolean(chatOpsConfig?.enabled && hasSlackWorkspace);
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
      notes={incident.notes.map(note => ({
        id: note.id,
        content: note.content,
        user: note.user,
        createdAt: note.createdAt,
      }))}
      canManage={canManageIncident || canAddIncidentNote}
      onAddNote={handleAddNote}
    />
  );

  const timelineContent = (
    <IncidentTimeline
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
      incidentCreatedAt={incident.createdAt}
      incidentAcknowledgedAt={incident.acknowledgedAt}
      incidentResolvedAt={incident.resolvedAt}
    />
  );

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
      warRoomUrl={incident.warRoomUrl}
      slackChannelName={incident.slackChannelName}
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
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
          <div className={`h-1 w-full bg-gradient-to-r ${statusGradient}`} />
          <div className="p-4 sm:p-6">
            <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
              <Link
                href={backHref}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{backLabel}</span>
              </Link>
              <div className="flex min-w-0 items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="hidden font-mono text-xs text-muted-foreground sm:inline-flex"
                >
                  #{id.slice(0, 8)}
                </Badge>
                <CopyButton text={id} label="ID" className="h-9 px-2 text-xs" />
                <CopyButton
                  text={`${appUrl}/incidents/${id}`}
                  icon="link"
                  label="Link"
                  className="h-9 px-2 text-xs"
                />
              </div>
            </div>

            <div className="flex min-w-0 items-start gap-3 sm:gap-4">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm sm:h-11 sm:w-11 ${statusGradient}`}
              >
                {incident.status === 'RESOLVED' ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : incident.status === 'SNOOZED' ? (
                  <Pause className="h-5 w-5" />
                ) : incident.status === 'SUPPRESSED' ? (
                  <Volume2 className="h-5 w-5" />
                ) : (
                  <AlertCircle className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="min-w-0 break-words text-lg font-bold leading-snug tracking-tight text-foreground sm:text-2xl">
                    {incident.title}
                  </h1>
                  <Badge
                    className={`shrink-0 border-0 bg-gradient-to-r text-xs font-bold text-white ${statusGradient}`}
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
          presentation === 'mobile'
            ? postmortem
              ? `/m/postmortems/${postmortem.id}`
              : `/m/postmortems`
            : `/postmortems/${id}`
        }
        postmortemExists={Boolean(postmortem)}
        warRoom={{
          slackChannelId: incident.slackChannelId,
          slackChannelName: incident.slackChannelName,
          warRoomUrl: incident.warRoomUrl,
          warRoomArchivedAt: incident.warRoomArchivedAt,
          enabled: isWarRoomEnabled,
        }}
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

      {presentation === 'mobile' ? (
        <details className="group overflow-hidden rounded-xl border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            <span>Incident details & assignment</span>
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

      <IncidentDescriptionCard
        incidentId={incident.id}
        description={incident.description}
        canManage={canManageIncident}
        onUpdateDescription={handleUpdateDescription}
      />

      <MicrosoftTeamsWarRoomsPanel
        incidentId={incident.id}
        rooms={teamsWarRooms}
        canManage={canManageIncident}
        enabled={teamsWarRoomEnabled}
        unavailableReason={teamsWarRoomUnavailableReason}
      />

      {incident.status === 'RESOLVED' && (
        <IncidentResolutionSummary
          incident={incident}
          resolutionNote={resolutionNote}
          postmortemStatus={postmortem?.status ?? null}
          canManage={canManageIncident}
        />
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="min-w-0 space-y-4 lg:col-span-8 lg:space-y-6 2xl:col-span-9">
          <IncidentDetailTabs
            eventCount={incident.events.length}
            noteCount={incident.notes.length}
            activityContent={activityContent}
            timelineContent={timelineContent}
            postmortemContent={postmortemContent}
            postmortemStatus={postmortem?.status ?? null}
          />
        </div>

        {presentation === 'mobile' ? (
          <details className="group overflow-hidden rounded-xl border border-border bg-card lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              <span>People, fields & links</span>
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
        ) : (
          <aside className="min-w-0 space-y-4 lg:col-span-4 lg:space-y-6 2xl:col-span-3">
            {watchersContent}
            {customFieldsContent}
            {quickLinksContent}
          </aside>
        )}
      </div>
    </div>
  );
}
