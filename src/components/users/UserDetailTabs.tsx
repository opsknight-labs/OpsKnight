'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  User,
  Users,
  Calendar,
  ShieldAlert,
  Mail,
  Phone,
  Globe,
  Building2,
  Briefcase,
  Bell,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Shield,
  Clock,
  Activity,
  AlertTriangle,
  History,
} from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';

export type UserDetailProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  gender?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  timeZone: string;
  phoneNumber?: string | null;
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  whatsappNotificationsEnabled: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastOidcSync?: Date | string | null;
  teamMemberships: Array<{
    id: string;
    role: string;
    team: {
      id: string;
      name: string;
      description?: string | null;
    };
  }>;
  teamsLed: Array<{
    id: string;
    name: string;
  }>;
  layerAssignments: Array<{
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
  }>;
  escalationRules: Array<{
    id: string;
    stepOrder: number;
    delayMinutes: number;
    policy: {
      id: string;
      name: string;
      description?: string | null;
    };
  }>;
  assignedIncidents: Array<{
    id: string;
    title: string;
    status: string;
    urgency?: string;
    priority?: string | null;
    createdAt: Date | string;
    service?: { id: string; name: string } | null;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    createdAt: Date | string;
    details?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }>;
};

type UserDetailTabsProps = {
  user: UserDetailProfile;
  canManage: boolean;
  defaultTab?: string;
};

export default function UserDetailTabs({
  user,
  canManage: _canManage,
  defaultTab = 'overview',
}: UserDetailTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(defaultTab);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', val);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-4">
      {/* Tab Navigation Pill Bar */}
      <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full h-auto p-1 bg-slate-100/80 rounded-xl border border-slate-200/60">
        <TabsTrigger
          value="overview"
          className="flex items-center gap-1.5 py-2 text-xs font-semibold rounded-lg data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-xs transition-all"
        >
          <User className="h-3.5 w-3.5" />
          <span>Profile & Overview</span>
        </TabsTrigger>

        <TabsTrigger
          value="teams"
          className="flex items-center gap-1.5 py-2 text-xs font-semibold rounded-lg data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-xs transition-all"
        >
          <Users className="h-3.5 w-3.5" />
          <span>Teams ({user.teamMemberships.length})</span>
        </TabsTrigger>

        <TabsTrigger
          value="schedules"
          className="flex items-center gap-1.5 py-2 text-xs font-semibold rounded-lg data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-xs transition-all"
        >
          <Calendar className="h-3.5 w-3.5" />
          <span>On-Call ({user.layerAssignments.length})</span>
        </TabsTrigger>

        <TabsTrigger
          value="activity"
          className="flex items-center gap-1.5 py-2 text-xs font-semibold rounded-lg data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-xs transition-all"
        >
          <Activity className="h-3.5 w-3.5" />
          <span>Activity & Routing</span>
        </TabsTrigger>
      </TabsList>

      {/* TAB 1: Profile & Overview */}
      <TabsContent value="overview" className="space-y-4 pt-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Contact & Identity Details */}
          <Card className="border-slate-200/80 bg-white shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Contact & Identity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-3 space-y-3.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-slate-50">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-slate-400" /> Email
                </span>
                <span className="font-medium text-foreground">{user.email}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-50">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-slate-400" /> Phone Number
                </span>
                <span className="font-medium text-foreground">
                  {user.phoneNumber || <span className="text-slate-400 italic">Not set</span>}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-50">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" /> Department
                </span>
                <span className="font-medium text-foreground">
                  {user.department || <span className="text-slate-400 italic">Unassigned</span>}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-50">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5 text-slate-400" /> Job Title
                </span>
                <span className="font-medium text-foreground">
                  {user.jobTitle || <span className="text-slate-400 italic">Not specified</span>}
                </span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-slate-400" /> Authoritative Time Zone
                </span>
                <span className="font-medium text-foreground">{user.timeZone}</span>
              </div>
            </CardContent>
          </Card>

          {/* Notification Alert Channels */}
          <Card className="border-slate-200/80 bg-white shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                Notification Channels
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-3 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <span className="font-medium">Email Paging</span>
                  {user.emailNotificationsEnabled ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Enabled
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-slate-100 text-slate-500 border-slate-200 text-[10px] gap-1"
                    >
                      <XCircle className="h-3 w-3" /> Disabled
                    </Badge>
                  )}
                </div>

                <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <span className="font-medium">SMS Alerts</span>
                  {user.smsNotificationsEnabled ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Enabled
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-slate-100 text-slate-500 border-slate-200 text-[10px] gap-1"
                    >
                      <XCircle className="h-3 w-3" /> Disabled
                    </Badge>
                  )}
                </div>

                <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <span className="font-medium">Browser Push</span>
                  {user.pushNotificationsEnabled ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Enabled
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-slate-100 text-slate-500 border-slate-200 text-[10px] gap-1"
                    >
                      <XCircle className="h-3 w-3" /> Disabled
                    </Badge>
                  )}
                </div>

                <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <span className="font-medium">WhatsApp Direct</span>
                  {user.whatsappNotificationsEnabled ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Enabled
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-slate-100 text-slate-500 border-slate-200 text-[10px] gap-1"
                    >
                      <XCircle className="h-3 w-3" /> Disabled
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground pt-1">
                Notification preferences dictate how escalation policies alert this member during
                active incident rotations.
              </p>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* TAB 2: Team Memberships */}
      <TabsContent value="teams" className="space-y-4 pt-1">
        <Card className="border-slate-200/80 bg-white shadow-2xs">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Team Memberships & Lead Roles
            </CardTitle>
            <CardDescription className="text-xs">
              Teams this member contributes to or leads within OpsKnight.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-3">
            {user.teamMemberships.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                This user has not been added to any teams yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {user.teamMemberships.map(membership => {
                  const isLead = user.teamsLed.some(t => t.id === membership.team.id);
                  return (
                    <div
                      key={membership.id}
                      className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs hover:border-primary/40 hover:shadow-xs transition-all flex items-center justify-between"
                    >
                      <div className="space-y-1 truncate pr-3">
                        <Link
                          href={`/teams/${membership.team.id}`}
                          className="font-bold text-xs text-foreground hover:text-primary transition-colors flex items-center gap-1.5 truncate"
                        >
                          {membership.team.name}
                          <ExternalLink className="h-3 w-3 opacity-50 shrink-0" />
                        </Link>
                        {membership.team.description && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {membership.team.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isLead && (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold"
                          >
                            Team Lead
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">
                          {membership.role}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* TAB 3: On-Call Coverage & Schedules */}
      <TabsContent value="schedules" className="space-y-4 pt-1">
        <Card className="border-slate-200/80 bg-white shadow-2xs">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              On-Call Schedules & Rotation Layers
            </CardTitle>
            <CardDescription className="text-xs">
              Schedules where this user is active in rotation layers.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-3">
            {user.layerAssignments.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                This user is not assigned to any on-call rotation layers.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {user.layerAssignments.map(assignment => (
                  <div
                    key={assignment.id}
                    className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs hover:border-primary/40 hover:shadow-xs transition-all flex items-center justify-between"
                  >
                    <div className="space-y-1 truncate pr-3">
                      <Link
                        href={`/schedules/${assignment.layer.schedule.id}`}
                        className="font-bold text-xs text-foreground hover:text-primary transition-colors flex items-center gap-1.5 truncate"
                      >
                        {assignment.layer.schedule.name}
                        <ExternalLink className="h-3 w-3 opacity-50 shrink-0" />
                      </Link>
                      <p className="text-[10px] text-muted-foreground truncate">
                        Layer:{' '}
                        <span className="font-medium text-slate-700">{assignment.layer.name}</span>
                      </p>
                    </div>

                    <Badge
                      variant="outline"
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] shrink-0 font-medium"
                    >
                      <Clock className="mr-1 h-3 w-3" /> Active
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* TAB 4: Incident Activity & Escalations */}
      <TabsContent value="activity" className="space-y-4 pt-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Escalation Policy Steps */}
          <Card className="border-slate-200/80 bg-white shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                Assigned Escalation Policies ({user.escalationRules.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-3">
              {user.escalationRules.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                  User is not directly targeted in any escalation rules.
                </div>
              ) : (
                <div className="space-y-2">
                  {user.escalationRules.map(rule => (
                    <div
                      key={rule.id}
                      className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5 truncate pr-2">
                        <Link
                          href={`/policies/${rule.policy.id}`}
                          className="font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1.5 truncate"
                        >
                          {rule.policy.name}
                          <ExternalLink className="h-3 w-3 opacity-50 shrink-0" />
                        </Link>
                        <span className="text-[10px] text-muted-foreground">
                          Step {rule.stepOrder + 1}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 font-normal">
                        {rule.delayMinutes === 0 ? 'Immediate' : `+${rule.delayMinutes}m`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assigned Incidents */}
          <Card className="border-slate-200/80 bg-white shadow-2xs">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Assigned Incidents ({user.assignedIncidents.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-3">
              {user.assignedIncidents.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                  No incidents assigned to this user.
                </div>
              ) : (
                <div className="space-y-2">
                  {user.assignedIncidents.slice(0, 5).map(inc => (
                    <div
                      key={inc.id}
                      className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5 truncate pr-2">
                        <Link
                          href={`/incidents/${inc.id}`}
                          className="font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1.5 truncate"
                        >
                          {inc.title}
                          <ExternalLink className="h-3 w-3 opacity-50 shrink-0" />
                        </Link>
                        {inc.service && (
                          <span className="text-[10px] text-muted-foreground">
                            {inc.service.name}
                          </span>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          inc.status === 'RESOLVED'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]'
                            : 'bg-rose-50 text-rose-700 border-rose-200 text-[10px]'
                        }
                      >
                        {inc.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  );
}
