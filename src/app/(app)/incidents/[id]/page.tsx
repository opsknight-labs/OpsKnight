import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getUserPermissions } from '@/lib/rbac';
import StatusBadge from '@/components/incident/StatusBadge';
import PriorityBadge from '@/components/incident/PriorityBadge';
import {
  addNote,
  addWatcher,
  removeWatcher,
  resolveIncidentWithNote,
  updateIncidentStatus,
  updateIncidentUrgency,
} from '../actions';
import { getPostmortem } from '@/app/(app)/postmortems/actions';
import IncidentHeader from '@/components/incident/IncidentHeader';
import IncidentSidebar from '@/components/incident/detail/IncidentSidebar';
import IncidentNotes from '@/components/incident/detail/IncidentNotes';
import IncidentTimeline from '@/components/incident/detail/IncidentTimeline';
import IncidentResolution from '@/components/incident/detail/IncidentResolution';
import IncidentJiraCard from '@/components/incident/detail/IncidentJiraCard';
import IncidentWarRoomCard from '@/components/incident/detail/IncidentWarRoomCard';
import IncidentCustomFields from '@/components/IncidentCustomFields';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import PrioritySelector from '@/components/incident/PrioritySelector';
import CopyButton from '@/components/common/CopyButton';
import {
  AlertCircle,
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  History,
  MessageSquare,
  Settings2,
  Timer,
  User,
  Zap,
} from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  // Calculate time open
  const getTimeOpen = () => {
    const start = new Date(incident.createdAt);
    const end = incident.resolvedAt ? new Date(incident.resolvedAt) : new Date();
    const diffInMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);
    if (diffInMinutes < 60) return `${diffInMinutes}m`;
    const hours = Math.floor(diffInMinutes / 60);
    const mins = diffInMinutes % 60;
    if (hours < 24) return `${hours}h ${mins}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  };

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

  async function handleSnooze() {
    'use server';
    await updateIncidentStatus(id, 'SNOOZED');
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

  async function handleResolve(formData: FormData) {
    'use server';
    const resolution = (formData.get('resolution') as string) || '';
    await resolveIncidentWithNote(id, resolution);
  }

  async function _handleUrgencyChange(formData: FormData) {
    'use server';
    const newUrgency = formData.get('urgency') as string;
    await updateIncidentUrgency(id, newUrgency);
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
  const urgencyVariantMap: Record<'HIGH' | 'MEDIUM' | 'LOW', 'danger' | 'warning' | 'success'> = {
    HIGH: 'danger',
    MEDIUM: 'warning',
    LOW: 'success',
  };
  const urgencyVariant =
    urgencyVariantMap[incident.urgency as 'HIGH' | 'MEDIUM' | 'LOW'] ?? 'success';

  return (
    <div className="w-full px-4 py-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 [zoom:0.8]">
      {/* Premium Header - Glassmorphic with Accent Bar */}
      <div className="group relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/80 shadow-xl backdrop-blur-xl transition-all hover:shadow-2xl">
        {/* Animated Accent Bar */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${getStatusColor()} animate-[pulse_3s_ease-in-out_infinite]`}
        />

        {/* Subtle Background Tint */}
        <div
          className={`absolute inset-0 bg-gradient-to-br ${getStatusColor()} opacity-[0.03] pointer-events-none`}
        />

        <div className="relative p-6 md:p-8">
          {/* Breadcrumb & Actions */}
          <div className="flex items-center justify-between mb-6">
            <Link
              href="/incidents"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors group/back"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover/back:-translate-x-0.5" />
              Back to Incidents
            </Link>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs text-slate-500 bg-slate-50">
                #{id.slice(0, 8)}
              </Badge>
              <div className="h-4 w-px bg-slate-200 mx-1" />
              <CopyButton
                text={id}
                label="ID"
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              />
              <CopyButton
                text={`${typeof window !== 'undefined' ? window.location.origin : ''}/incidents/${id}`}
                icon="link"
                label="Link"
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              />
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-start gap-6">
            {/* Large Status Icon */}
            <div
              className={`shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br ${getStatusColor()} flex items-center justify-center shadow-lg transform group-hover:scale-105 transition-transform duration-300`}
            >
              <AlertCircle className="h-8 w-8 text-white" />
            </div>

            {/* Title and Status */}
            <div className="space-y-3 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight leading-tight">
                  {incident.title}
                </h1>
                <Badge
                  variant="outline"
                  className={`px-3 py-1 rounded-full border-0 font-bold tracking-wide shadow-sm bg-gradient-to-r ${getStatusColor()} text-white`}
                >
                  {incident.status}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid - Priority, Urgency, Assignee, Service */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        {/* Priority Card */}
        <div className="group relative rounded-xl border border-slate-200/60 bg-white/50 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                <Activity className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Priority
              </span>
            </div>
            <PrioritySelector
              incidentId={incident.id}
              priority={incident.priority}
              canManage={canManageIncident}
            />
          </div>
        </div>

        {/* Urgency Card */}
        <div className="group relative rounded-xl border border-slate-200/60 bg-white/50 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-red-400 to-rose-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-600">
                <AlertCircle className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Urgency
              </span>
            </div>
            <div className="flex items-center">
              <Badge
                variant={urgencyVariant}
                size="sm"
                className="uppercase font-bold tracking-wide"
              >
                {incident.urgency}
              </Badge>
            </div>
          </div>
        </div>

        {/* Assignee Card */}
        <div className="group relative rounded-xl border border-slate-200/60 bg-white/50 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-violet-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center text-violet-600">
                <User className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Assignee
              </span>
            </div>
            <div className="flex items-center gap-2">
              {incident.assignee ? (
                <>
                  <Avatar className="h-6 w-6 border border-slate-200">
                    <AvatarImage
                      src={
                        incident.assignee.avatarUrl ||
                        getDefaultAvatar(incident.assignee.gender, incident.assignee.id)
                      }
                    />
                    <AvatarFallback className="text-[9px] bg-slate-100 text-slate-600">
                      {incident.assignee.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-semibold text-sm truncate text-slate-900">
                    {incident.assignee.name}
                  </span>
                </>
              ) : incident.team ? (
                <>
                  <div className="h-6 w-6 rounded-full border border-indigo-200 bg-indigo-100 flex items-center justify-center">
                    <User className="h-3 w-3 text-indigo-600" />
                  </div>
                  <span className="font-semibold text-sm truncate text-slate-900">
                    {incident.team.name}
                  </span>
                </>
              ) : (
                <span className="text-sm text-slate-400 italic">Unassigned</span>
              )}
            </div>
          </div>
        </div>

        {/* Service Card */}
        <div className="group relative rounded-xl border border-slate-200/60 bg-white/50 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-amber-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                <Zap className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Service
              </span>
            </div>
            <div className="font-semibold text-sm truncate text-slate-900 pl-1">
              {incident.service.name}
            </div>
          </div>
        </div>
      </div>

      {/* Description Section - Enhanced with Better Styling */}
      {incident.description && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-6 shadow-sm">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-slate-500" />
            Description
          </h3>
          <div className="prose prose-sm prose-slate max-w-none">
            <p className="text-slate-700 leading-relaxed whitespace-pre-wrap break-words m-0">
              {incident.description}
            </p>
          </div>
        </div>
      )}

      {/* Main Grid - Like Teams Page */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        {/* Main Content - 3 columns */}
        <div className="xl:col-span-3 space-y-4 md:space-y-6">
          {/* Incident Details Card */}
          <IncidentHeader
            incident={incident as any} // eslint-disable-line @typescript-eslint/no-explicit-any
            users={users}
            teams={teams}
            canManage={canManageIncident}
          />

          {/* Tabbed Content */}
          <div className="space-y-6">
            <div className="flex items-center justify-between px-1">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Incident Details</h2>
                <p className="text-sm text-slate-500">Timeline, notes, and resolution</p>
              </div>
              <Badge variant="outline" className="gap-1.5 py-1 px-2 border-slate-300 bg-white">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                <span className="font-medium">{incident.events.length} Events</span>
              </Badge>
            </div>
            <div className="bg-transparent">
              <Tabs defaultValue="overview" className="w-full mt-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="overview" className="gap-2">
                    <Settings2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Overview</span>
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="gap-2">
                    <History className="h-4 w-4" />
                    <span className="hidden sm:inline">Timeline</span>
                  </TabsTrigger>
                </TabsList>

                <div className="mt-6">
                  <TabsContent value="overview" className="mt-0 space-y-6">
                    {/* Resolution Form */}
                    {incident.status !== 'RESOLVED' && (
                      <IncidentResolution
                        incidentId={incident.id}
                        canManage={canManageIncident}
                        onResolve={handleResolve}
                      />
                    )}

                    {/* Postmortem Section */}
                    {incident.status === 'RESOLVED' && (
                      <Card className="border-green-200 bg-green-50/50">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-green-900">
                            <FileText className="h-5 w-5" />
                            Postmortem
                          </CardTitle>
                          <CardDescription className="text-green-700">
                            Document lessons learned for this resolved incident
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {postmortem ? (
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
                                <CheckCircle2 className="h-4 w-4" />
                                Postmortem Filed
                              </span>
                              <Link href={`/postmortems/${id}`}>
                                <Button variant="outline" size="sm">
                                  View Report
                                </Button>
                              </Link>
                            </div>
                          ) : (
                            <Link href={`/postmortems/${id}`}>
                              <Button className="w-full md:w-auto">Create Postmortem</Button>
                            </Link>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Custom Fields - Only show when fields are configured */}
                    {customFields.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Custom Fields</CardTitle>
                          <CardDescription>Additional incident metadata</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <IncidentCustomFields
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
                        </CardContent>
                      </Card>
                    )}

                    {/* Notes Section - Now in Overview for visibility */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <MessageSquare className="h-4 w-4" />
                          Notes & Updates
                          {incident.notes.length > 0 && (
                            <Badge variant="secondary" size="xs" className="ml-auto">
                              {incident.notes.length}
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription>
                          Communication and updates for this incident
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <IncidentNotes
                          notes={incident.notes.map(n => ({
                            id: n.id,
                            content: n.content,
                            user: n.user,
                            createdAt: n.createdAt,
                          }))}
                          canManage={canManageIncident}
                          onAddNote={handleAddNote}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="timeline" className="mt-0">
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
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </div>
        </div>

        {/* Sidebar - 1 column */}
        <aside className="space-y-4 md:space-y-6">
          <IncidentSidebar
            incident={{
              id: incident.id,
              status: incident.status,
              assigneeId: incident.assigneeId,
              assignee: incident.assignee,
              service: incident.service,
              acknowledgedAt: incident.acknowledgedAt,
              resolvedAt: incident.resolvedAt,
              createdAt: incident.createdAt,
              escalationStatus: incident.escalationStatus,
              currentEscalationStep: incident.currentEscalationStep,
              nextEscalationAt: incident.nextEscalationAt,
            }}
            users={users}
            watchers={incident.watchers.map(w => ({
              id: w.id,
              user: w.user,
              role: w.role,
            }))}
            tags={incident.tags.map(t => ({
              id: t.tag.id,
              name: t.tag.name,
              color: t.tag.color,
            }))}
            canManage={canManageIncident}
            onAcknowledge={handleAcknowledge}
            onUnacknowledge={handleUnacknowledge}
            onSnooze={handleSnooze}
            onUnsnooze={handleUnsnooze}
            onSuppress={handleSuppress}
            onUnsuppress={handleUnsuppress}
            onAddWatcher={handleAddWatcher}
            onRemoveWatcher={handleRemoveWatcher}
          />

          {/* Jira Issues */}
          <IncidentJiraCard
            incidentId={id}
            serviceSettingsHref={`/services/${incident.serviceId}/settings`}
            jiraLinks={jiraLinks}
            jiraEnabled={jiraConfig?.enabled ?? false}
            serviceJiraMapped={Boolean(incident.service.jiraServiceMapping?.projectKey)}
            canManage={canManageIncident}
          />

          {/* ChatOps War-Room */}
          <IncidentWarRoomCard
            incident={{
              id: incident.id,
              slackChannelId: incident.slackChannelId,
              slackChannelName: incident.slackChannelName,
              warRoomUrl: incident.warRoomUrl,
              warRoomArchivedAt: incident.warRoomArchivedAt,
              status: incident.status,
              service: { name: incident.service.name },
            }}
            canManage={canManageIncident}
          />

          {/* Quick Links - Like Teams Page */}
          <div className="rounded-xl border border-slate-200/60 bg-white/50 shadow-sm p-5">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-4">
              Quick Links
            </h3>
            <div className="space-y-2">
              <Link href={`/services/${incident.serviceId}`}>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 bg-white hover:bg-slate-50 h-9 text-sm"
                >
                  <Zap className="h-4 w-4" />
                  View Service
                </Button>
              </Link>
              <Link href={`/analytics?incident=${incident.id}`}>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 bg-white hover:bg-slate-50 h-9 text-sm"
                >
                  <Clock className="h-4 w-4" />
                  View in Analytics
                </Button>
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
