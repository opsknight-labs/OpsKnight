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
};

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
}: ProfileDetailTabsProps) {
  const ledTeamIds = new Set(teamsLed.map(t => t.id));
  const totalTeams = teams.length;
  const totalSchedules = layerAssignments.length;
  const totalTeamsAndSchedules = totalTeams + totalSchedules;

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
                icon={<Users className="h-8 w-8 text-muted-foreground/60" />}
                title="No team memberships"
                description="You are not currently assigned to any team in this organization."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {teams.map(membership => {
                  const isLead = ledTeamIds.has(membership.team.id);
                  return (
                    <Link
                      key={membership.id}
                      href={`/teams/${membership.team.id}`}
                      className="group flex flex-col justify-between rounded-lg border border-border bg-card p-4 transition-all duration-150 hover:bg-muted/30 hover:border-primary/40 hover:shadow-xs"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                            {membership.team.name}
                          </h4>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isLead && (
                              <Badge
                                variant="outline"
                                size="xs"
                                className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-400/30 gap-1 text-[10px]"
                              >
                                <Crown className="h-2.5 w-2.5" /> Lead
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              size="xs"
                              className="uppercase text-[9px] font-bold"
                            >
                              {membership.role}
                            </Badge>
                          </div>
                        </div>
                        {membership.team.description && (
                          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                            {membership.team.description}
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex items-center justify-end text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
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

        {/* Active On-Call Schedule Rotations */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>On-Call Schedule Rotations</span>
                </CardTitle>
                <CardDescription>Active rotation layers and shifts you are part of</CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">
                {layerAssignments.length} {layerAssignments.length === 1 ? 'Schedule' : 'Schedules'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {layerAssignments.length === 0 ? (
              <EmptyState
                icon={<Calendar className="h-8 w-8 text-muted-foreground/60" />}
                title="No on-call schedules"
                description="You are not currently assigned to any active on-call rotation layers."
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
