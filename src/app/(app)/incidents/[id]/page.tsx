import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { assertCanViewIncident, getUserPermissions } from '@/lib/rbac';
import { addNote, addWatcher, removeWatcher, updateIncidentStatus } from '../actions';
import { getPostmortem } from '@/app/(app)/postmortems/actions';
import IncidentHeader from '@/components/incident/IncidentHeader';
import IncidentWatchers from '@/components/incident/detail/IncidentWatchers';
import IncidentJiraCard from '@/components/incident/detail/IncidentJiraCard';
import IncidentCommandBar from '@/components/incident/detail/IncidentCommandBar';
import IncidentDetailTabs from '@/components/incident/IncidentDetailTabs';
import IncidentNotes from '@/components/incident/detail/IncidentNotes';
import IncidentTimeline from '@/components/incident/detail/IncidentTimeline';
import IncidentResolutionSummary from '@/components/incident/detail/IncidentResolutionSummary';
import IncidentPostmortemCard from '@/components/incident/detail/IncidentPostmortemCard';
import IncidentDescriptionCard from '@/components/incident/detail/IncidentDescriptionCard';
import IncidentSLABadges from '@/components/incident/detail/IncidentSLABadges';
import IncidentCustomFieldsCard from '@/components/incident/detail/IncidentCustomFieldsCard';
import IncidentQuickLinksCard from '@/components/incident/detail/IncidentQuickLinksCard';
import { Badge } from '@/components/ui/shadcn/badge';
import CopyButton from '@/components/common/CopyButton';
import { getAppUrl } from '@/lib/app-url';
import { AlertCircle, ArrowLeft, CheckCircle2, Pause, Volume2 } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await assertCanViewIncident(id);
  const appUrl = await getAppUrl();
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      service: {
        include: {
          policy: true,
          jiraServiceMapping: {
            select: { projectKey: true },
          },
        },
      },
      assignee: true,
      team: true,
      events: { orderBy: { createdAt: 'desc' } },
      notes: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      watchers: { include: { user: true }, orderBy: { createdAt: 'asc' } },
      tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
      customFieldValues: {
        include: {
          customField: true,
        },
      },
    },
  });

  if (!incident) notFound();

  const [users, teams, customFields] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        gender: true,
        role: true,
      },
    }),
    prisma.team.findMany(),
    prisma.customField.findMany({ orderBy: { order: 'asc' } }),
  ]);
  const permissions = await getUserPermissions();
  const canManageIncident = permissions.isResponderOrAbove;
  const canAcknowledgeIncident = permissions.capabilities.includes('incident.acknowledge.scoped');
  const canAddIncidentNote = permissions.capabilities.includes('incident.note.scoped');

  // Check if postmortem exists for this incident
  const postmortem = incident.status === 'RESOLVED' ? await getPostmortem(id) : null;

  // Fetch Jira data for the incident sidebar
  const [jiraLinks, jiraConfig] = await Promise.all([
    prisma.externalIssueLink.findMany({
      where: { incidentId: id, provider: 'JIRA' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.jiraConfig.findUnique({
      where: { id: 'default' },
      select: { enabled: true },
    }),
  ]);

  // The resolution note is stored as a regular Note prefixed with "Resolution:" —
  // there's no separate resolution-summary column on Incident.
  const resolutionNote = incident.notes.find(n => n.content.startsWith('Resolution:')) ?? null;

  // Server actions
  async function handleAddNote(formData: FormData) {
    'use server';
    const content = formData.get('content') as string;
    await addNote(id, content);
  }

  async function handleAcknowledge() {
    'use server';
    await updateIncidentStatus(id, 'ACKNOWLEDGED');
  }

  async function handleUnacknowledge() {
    'use server';
    await updateIncidentStatus(id, 'OPEN');
  }

  async function handleSuppress() {
    'use server';
    await updateIncidentStatus(id, 'SUPPRESSED');
  }

  async function handleUnsnooze() {
    'use server';
    await updateIncidentStatus(id, 'OPEN');
  }

  async function handleUnsuppress() {
    'use server';
    await updateIncidentStatus(id, 'OPEN');
  }

  async function handleAddWatcher(formData: FormData) {
    'use server';
    const watcherId = formData.get('watcherId') as string;
    const role = formData.get('watcherRole') as string;
    await addWatcher(id, watcherId, role);
  }

  async function handleRemoveWatcher(formData: FormData) {
    'use server';
    const watcherId = formData.get('watcherMemberId') as string;
    await removeWatcher(id, watcherId);
  }

  const getStatusColor = () => {
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
  };
  const postmortemHref = `/postmortems/${id}`;

  const activityContent = (
    <IncidentNotes
      notes={incident.notes.map(n => ({
        id: n.id,
        content: n.content,
        user: n.user,
        createdAt: n.createdAt,
      }))}
      canManage={canManageIncident || canAddIncidentNote}
      onAddNote={handleAddNote}
    />
  );

  const timelineContent = (
    <IncidentTimeline
      events={incident.events.map(e => ({
        id: e.id,
        message: e.message,
        createdAt: e.createdAt,
      }))}
      incidentCreatedAt={incident.createdAt}
      incidentAcknowledgedAt={incident.acknowledgedAt}
      incidentResolvedAt={incident.resolvedAt}
    />
  );

  return (
    <div className="w-full px-4 py-6 pb-24 sm:pb-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Incident Hero Title Card — Stable, crisp, no flickering */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:bg-slate-900 dark:border-slate-800">
        {/* Crisp status accent line at top */}
        <div className={`h-1 w-full bg-gradient-to-r ${getStatusColor()}`} />

        <div className="p-5 md:p-6">
          {/* Breadcrumb & Quick Reference */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link
              href="/incidents"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Incidents</span>
            </Link>
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className="font-mono text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              >
                #{id.slice(0, 8)}
              </Badge>
              <div className="h-3.5 w-px bg-slate-200 dark:bg-slate-700 mx-1" />
              <CopyButton
                text={id}
                label="ID"
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 h-6 px-2 text-xs"
              />
              <CopyButton
                text={`${appUrl}/incidents/${id}`}
                icon="link"
                label="Link"
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 h-6 px-2 text-xs"
              />
            </div>
          </div>

          <div className="flex items-start gap-4">
            {/* Status Icon */}
            <div
              className={`shrink-0 w-11 h-11 rounded-lg bg-gradient-to-br ${getStatusColor()} flex items-center justify-center shadow-sm text-white`}
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

            {/* Title and Status Badge */}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-snug">
                  {incident.title}
                </h1>
                <Badge
                  variant="outline"
                  className={`px-2.5 py-0.5 rounded-md border-0 font-bold tracking-wide shadow-2xs bg-gradient-to-r ${getStatusColor()} text-white text-xs shrink-0`}
                >
                  {incident.status}
                </Badge>
              </div>

              {/* Live Response Health & SLA Status Pills */}
              <IncidentSLABadges incident={incident} service={incident.service} />
            </div>
          </div>
        </div>
      </div>

      {/* Incident Command Bar Card — Collaboration Tools on Left, Lifecycle Actions on Right */}
      <IncidentCommandBar
        incidentId={incident.id}
        currentStatus={incident.status}
        canManage={canManageIncident}
        canAcknowledge={canManageIncident || canAcknowledgeIncident}
        snoozedUntil={incident.snoozedUntil}
        onAcknowledge={handleAcknowledge}
        onUnacknowledge={handleUnacknowledge}
        onUnsnooze={handleUnsnooze}
        onSuppress={handleSuppress}
        onUnsuppress={handleUnsuppress}
        resolvingIncident={{
          id: incident.id,
          title: incident.title,
          service: { name: incident.service.name },
        }}
        postmortemHref={postmortemHref}
        postmortemExists={Boolean(postmortem)}
        warRoom={{
          slackChannelId: incident.slackChannelId,
          slackChannelName: incident.slackChannelName,
          warRoomUrl: incident.warRoomUrl,
          warRoomArchivedAt: incident.warRoomArchivedAt,
        }}
        jira={{
          links: jiraLinks,
          enabled: jiraConfig?.enabled ?? false,
          serviceMapped: Boolean(incident.service.jiraServiceMapping?.projectKey),
          serviceSettingsHref: `/services/${incident.serviceId}/settings`,
        }}
        tags={incident.tags.map(t => ({
          id: t.tag.id,
          name: t.tag.name,
          color: t.tag.color,
        }))}
      />

      {/* Incident Details Card — single unified card for all metadata */}
      <IncidentHeader
        incident={incident as any} // eslint-disable-line @typescript-eslint/no-explicit-any
        users={users}
        teams={teams}
        canManage={canManageIncident}
      />

      {/* Incident Description Card — Full width, rich markdown, inline edit for responders, 1-click copy */}
      <IncidentDescriptionCard
        incidentId={incident.id}
        description={incident.description}
        canManage={canManageIncident}
      />

      {incident.status === 'RESOLVED' && (
        <IncidentResolutionSummary
          incident={incident}
          service={incident.service}
          resolutionNote={resolutionNote}
        />
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
        {/* Main Content */}
        <div className="lg:col-span-8 xl:col-span-8 2xl:col-span-9 space-y-4 md:space-y-6">
          <IncidentDetailTabs
            eventCount={incident.events.length}
            noteCount={incident.notes.length}
            activityContent={activityContent}
            timelineContent={timelineContent}
          />
        </div>

        {/* Response Rail */}
        <aside className="lg:col-span-4 xl:col-span-4 2xl:col-span-3 space-y-4 md:space-y-6">
          <IncidentWatchers
            watchers={incident.watchers.map(w => ({
              id: w.id,
              user: w.user,
              role: w.role,
            }))}
            users={users}
            canManage={canManageIncident}
            currentUserId={user.id}
            onAddWatcher={handleAddWatcher}
            onRemoveWatcher={handleRemoveWatcher}
          />

          {/* Custom Fields in Sidebar */}
          <IncidentCustomFieldsCard
            incidentId={id}
            customFieldValues={
              incident.customFieldValues?.map(v => ({
                id: v.id,
                value: v.value,
                customField: v.customField,
              })) || []
            }
            allCustomFields={customFields}
            canManage={canManageIncident}
          />

          {/* Jira Integration */}
          <IncidentJiraCard
            incidentId={incident.id}
            serviceSettingsHref={`/services/${incident.serviceId}/settings`}
            jiraLinks={jiraLinks.map(l => ({
              id: l.id,
              externalKey: l.externalKey,
              externalUrl: l.externalUrl,
              externalStatus: l.externalStatus,
              externalAssignee: l.externalAssignee,
              syncState: l.syncState,
              lastSyncedAt: l.lastSyncedAt,
            }))}
            jiraEnabled={jiraConfig?.enabled ?? false}
            serviceJiraMapped={Boolean(incident.service.jiraServiceMapping?.projectKey)}
            canManage={canManageIncident}
          />

          {/* Upgraded Quick Links */}
          <IncidentQuickLinksCard
            incidentId={incident.id}
            service={{
              id: incident.service.id,
              name: incident.service.name,
              status: incident.service.status,
              slaTier: incident.service.slaTier,
              policy: incident.service.policy
                ? {
                    id: incident.service.policy.id,
                    name: incident.service.policy.name,
                  }
                : null,
            }}
            team={
              incident.team
                ? {
                    id: incident.team.id,
                    name: incident.team.name,
                  }
                : null
            }
            warRoomUrl={incident.warRoomUrl}
            slackChannelName={incident.slackChannelName}
            status={incident.status}
            postmortemExists={Boolean(postmortem)}
          />

          {incident.status === 'RESOLVED' && (
            <IncidentPostmortemCard
              incidentId={id}
              postmortemStatus={postmortem?.status ?? null}
              canManage={canManageIncident}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
