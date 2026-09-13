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
import { AlertCircle, ArrowLeft, CheckCircle2, Pause, Volume2 } from 'lucide-react';
import { getJiraCapabilities } from '@/lib/jira-capabilities';
import { serializeJiraIssueReference } from '@/lib/jira-references';

export type IncidentDetailScreenProps = {
  id: string;
  backHref: string;
  backLabel?: string;
};

/**
 * Canonical responsive incident-detail experience used by desktop and PWA.
 * Data loading, authorization, commands, Jira/War Room capability checks and
 * feature visibility live here so presentation routes cannot drift.
 */
export default async function IncidentDetailScreen({
  id,
  backHref,
  backLabel = 'Back to Incidents',
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
  const [users, teams, customFields] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, avatarUrl: true, gender: true, role: true },
    }),
    prisma.team.findMany(),
    prisma.customField.findMany({ orderBy: { order: 'asc' } }),
  ]);

  const permissions = await getUserPermissions();
  const canManageIncident = permissions.isResponderOrAbove;
  const canAcknowledgeIncident = permissions.capabilities.includes('incident.acknowledge.scoped');
  const canAddIncidentNote = permissions.capabilities.includes('incident.note.scoped');
  const incidentJiraCapability = await getJiraCapabilities({
    serviceId: incident.serviceId,
    canManage: canManageIncident,
  });
  const postmortem = incident.status === 'RESOLVED' ? await getPostmortem(id) : null;

  // Rendering an incident must not perform hidden Jira network I/O. Persisted
  // state is refreshed by authenticated webhooks or explicit sync actions.
  const [jiraLinks, chatOpsConfig, globalSlackIntegration] = await Promise.all([
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
  ]);

  const incidentJiraIssues = jiraLinks.map(serializeJiraIssueReference);
  const hasSlackWorkspace = Boolean(
    (incident.service.slackIntegration?.workspaceId &&
      incident.service.slackIntegration?.enabled !== false) ||
      globalSlackIntegration?.workspaceId
  );
  const isWarRoomEnabled = Boolean(chatOpsConfig?.enabled && hasSlackWorkspace);
  const resolutionNote = incident.notes.find(note => note.content.startsWith('Resolution:')) ?? null;

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

  return (
    <div className="responsive-page w-full space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6">
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
              <Badge variant="outline" className="hidden font-mono text-xs text-muted-foreground sm:inline-flex">
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
                <Badge className={`shrink-0 border-0 bg-gradient-to-r text-xs font-bold text-white ${statusGradient}`}>
                  {incident.status}
                </Badge>
              </div>
              <IncidentSLABadges sla={incidentSla} />
            </div>
          </div>
        </div>
      </section>

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
        postmortemHref={`/postmortems/${id}`}
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

      <IncidentHeader incident={incident} users={users} teams={teams} canManage={canManageIncident} />

      <IncidentDescriptionCard
        incidentId={incident.id}
        description={incident.description}
        canManage={canManageIncident}
        onUpdateDescription={handleUpdateDescription}
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

        <aside className="min-w-0 space-y-4 lg:col-span-4 lg:space-y-6 2xl:col-span-3">
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
          />
        </aside>
      </div>
    </div>
  );
}
