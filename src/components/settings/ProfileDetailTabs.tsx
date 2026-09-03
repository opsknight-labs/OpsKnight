'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import EmptyState from '@/components/ui/EmptyState';
import {
  User,
  Bell,
  Clock,
  Users,
  Calendar,
  ShieldAlert,
  ArrowUpRight,
  Crown,
  Layers,
  ShieldCheck,
  Flame,
  Activity,
  CheckCircle2,
} from 'lucide-react';

export type ProfileDetailTab = 'profile' | 'notifications' | 'schedule' | 'teams';

type TeamMembership = {
  id: string;
  role: string;
  team: {
    id: string;
    name: string;
    description?: string | null;
  };
};

type TeamLed = {
  id: string;
  name: string;
};

type LayerAssignment = {
  id: string;
  layer: {
    id: string;
    name: string;
    schedule: {
      id: string;
      name: string;
      timeZone: string;
    };
  };
};

type EscalationRule = {
  id: string;
  stepOrder: number;
  delayMinutes: number;
  policy: {
    id: string;
    name: string;
    description?: string | null;
  };
};

export type UserSLAMetricsSummary = {
  mtta?: number | null;
  mttr?: number | null;
  mttaP50?: number | null;
  mttrP50?: number | null;
  resolveCompliance?: number | null;
  ackCompliance?: number | null;
  activeIncidents?: number;
  resolvedIncidents?: number;
  totalIncidents?: number;
};

type ProfileDetailTabsProps = {
  defaultTab?: string;
  profileContent: ReactNode;
  notificationsContent: ReactNode;
  scheduleContent: ReactNode;
  teams: TeamMembership[];
  teamsLed: TeamLed[];
  layerAssignments: LayerAssignment[];
  escalationRules: EscalationRule[];
  activeChannelsCount?: number;
  slaMetrics?: UserSLAMetricsSummary | null;
};

function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes === 0) return '0m';
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = Math.round(minutes % 60);
  return `${hours}h ${remainingMins}m`;
}

export default function ProfileDetailTabs({
  defaultTab = 'profile',
  profileContent,
  notificationsContent,
  scheduleContent,
  teams,
  teamsLed,
  layerAssignments,
  escalationRules,
  activeChannelsCount,
  slaMetrics,
}: ProfileDetailTabsProps) {
  const ledTeamIds = new Set(teamsLed.map(t => t.id));
  const totalTeams = teams.length;
  const totalSchedules = layerAssignments.length;
  const totalTeamsAndSchedules = totalTeams + totalSchedules;

  const complianceVal = slaMetrics?.resolveCompliance ?? slaMetrics?.ackCompliance ?? 100;

  const tabItems = [
    {
      id: 'profile',
      label: 'Profile & Identity',
      icon: <User className="h-3.5 w-3.5" />,
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: <Bell className="h-3.5 w-3.5" />,
      count:
        activeChannelsCount !== undefined && activeChannelsCount > 0
          ? activeChannelsCount
          : undefined,
    },
    {
      id: 'schedule',
      label: 'Timezone & Quiet Hours',
      icon: <Clock className="h-3.5 w-3.5" />,
    },
    {
      id: 'teams',
      label: 'Teams & On-Call',
      icon: <Users className="h-3.5 w-3.5" />,
      count: totalTeamsAndSchedules > 0 ? totalTeamsAndSchedules : undefined,
    },
  ];

  return (
    <DetailTabs tabs={tabItems} defaultTab={defaultTab} layout="grid">
      {/* Tab 1: Profile & Identity */}
      <DetailTabContent value="profile" className="space-y-6">
        {profileContent}
      </DetailTabContent>

      {/* Tab 2: Notifications */}
      <DetailTabContent value="notifications" className="space-y-6">
        {notificationsContent}
      </DetailTabContent>

      {/* Tab 3: Timezone & Quiet Hours */}
      <DetailTabContent value="schedule" className="space-y-6">
        {scheduleContent}
      </DetailTabContent>

      {/* Tab 4: Teams & On-Call Rotations */}
      <DetailTabContent value="teams" className="space-y-6">
        {/* SLA & Response Performance Card (Centralized via sla-server) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span>SLA & Response Performance</span>
                  <Badge variant="secondary" className="text-[10px] font-medium ml-1">
                    Last 30 Days
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Your incident response, resolution, and SLA compliance metrics computed over the
                  last 30 days
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs font-semibold self-start sm:self-auto"
              >
                {complianceVal.toFixed(1)}% Compliance (30d)
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              <div className="p-3.5 rounded-lg border bg-card/60 space-y-1">
                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary/70" />
                  MTTA (Acknowledge)
                </p>
                <p className="text-lg font-bold font-mono text-foreground">
                  {formatMinutes(slaMetrics?.mttaP50)}
                </p>
                <p className="text-[11px] text-muted-foreground">Median response time (last 30d)</p>
              </div>

              <div className="p-3.5 rounded-lg border bg-card/60 space-y-1">
                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5 text-primary/70" />
                  MTTR (Resolution)
                </p>
                <p className="text-lg font-bold font-mono text-foreground">
                  {formatMinutes(slaMetrics?.mttr ?? slaMetrics?.mttrP50)}
                </p>
                <p className="text-[11px] text-muted-foreground">Mean resolution time (last 30d)</p>
              </div>

              <div className="p-3.5 rounded-lg border bg-card/60 space-y-1">
                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-primary/70" />
                  Active Incidents
                </p>
                <p className="text-lg font-bold font-mono text-foreground">
                  {slaMetrics?.activeIncidents ?? 0}
                </p>
                <p className="text-[11px] text-muted-foreground">Assigned in progress</p>
              </div>

              <div className="p-3.5 rounded-lg border bg-card/60 space-y-1">
                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  Total Resolved
                </p>
                <p className="text-lg font-bold font-mono text-foreground">
                  {slaMetrics?.resolvedIncidents ?? 0}
                </p>
                <p className="text-[11px] text-muted-foreground">Resolved in last 30d</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Team Memberships Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <span>Team Memberships</span>
                </CardTitle>
                <CardDescription>Teams you belong to in this workspace</CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">
                {teams.length} {teams.length === 1 ? 'Team' : 'Teams'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {teams.length === 0 ? (
              <EmptyState
                icon={<Users className="h-6 w-6 text-muted-foreground" />}
                title="No team memberships"
                description="You haven't been added to any team yet. Team leads can invite you to collaborative response squads."
                variant="card"
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {teams.map(m => {
                  const isLead = ledTeamIds.has(m.team.id);
                  return (
                    <Link
                      key={m.id}
                      href={`/teams/${m.team.id}`}
                      className="group flex flex-col justify-between rounded-lg border border-border bg-card p-4 transition-all duration-150 hover:bg-muted/30 hover:border-primary/40 hover:shadow-xs"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                            {m.team.name}
                          </h4>
                          {isLead ? (
                            <Badge
                              variant="outline"
                              size="xs"
                              className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] gap-1 shrink-0"
                            >
                              <Crown className="h-2.5 w-2.5" /> Lead
                            </Badge>
                          ) : (
                            <Badge variant="secondary" size="xs" className="text-[10px] shrink-0">
                              {m.role}
                            </Badge>
                          )}
                        </div>
                        {m.team.description && (
                          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                            {m.team.description}
                          </p>
                        )}
                      </div>
                      <div className="mt-4 flex items-center justify-end text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
                        <span className="flex items-center gap-1">
                          View Team <ArrowUpRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* On-Call Schedules Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>On-Call Rotations</span>
                </CardTitle>
                <CardDescription>
                  Schedules and rotation layers where you are currently assigned
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">
                {layerAssignments.length} {layerAssignments.length === 1 ? 'Rotation' : 'Rotations'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {layerAssignments.length === 0 ? (
              <EmptyState
                icon={<Calendar className="h-6 w-6 text-muted-foreground" />}
                title="No on-call rotations"
                description="You are not assigned to any on-call rotation layers currently."
                variant="card"
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {layerAssignments.map(assignment => (
                  <Link
                    key={assignment.id}
                    href={`/schedules/${assignment.layer.schedule.id}`}
                    className="group flex flex-col justify-between rounded-lg border border-border bg-card p-4 transition-all duration-150 hover:bg-muted/30 hover:border-primary/40 hover:shadow-xs"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {assignment.layer.schedule.name}
                        </h4>
                        <Badge variant="outline" size="xs" className="text-[10px] gap-1">
                          <Layers className="h-2.5 w-2.5" /> Layer
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{assignment.layer.name}</p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground/80 font-mono">
                        TZ: {assignment.layer.schedule.timeZone}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-end text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
                      <span className="flex items-center gap-1">
                        View Schedule <ArrowUpRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Escalation Policies */}
        {escalationRules.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-primary" />
                    <span>Escalation Policy Targets</span>
                  </CardTitle>
                  <CardDescription>
                    Escalation paths where you are designated as a responder
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs">
                  {escalationRules.length} {escalationRules.length === 1 ? 'Policy' : 'Policies'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {escalationRules.map(rule => (
                  <Link
                    key={rule.id}
                    href={`/policies/${rule.policy.id}`}
                    className="group flex flex-col justify-between rounded-lg border border-border bg-card p-4 transition-all duration-150 hover:bg-muted/30 hover:border-primary/40 hover:shadow-xs"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {rule.policy.name}
                        </h4>
                        <Badge variant="outline" size="xs" className="text-[10px]">
                          Step {rule.stepOrder}
                        </Badge>
                      </div>
                      {rule.policy.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {rule.policy.description}
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] text-muted-foreground/80">
                        Escalates after {rule.delayMinutes} minutes
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-end text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
                      <span className="flex items-center gap-1">
                        View Policy <ArrowUpRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </DetailTabContent>
    </DetailTabs>
  );
}
