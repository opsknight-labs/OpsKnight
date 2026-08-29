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
  Activity,
  Mail,
  Phone,
  Building2,
  Briefcase,
  Globe,
  Clock,
  Bell,
  MessageSquare,
  Smartphone,
  Shield,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flame,
  ArrowUpRight,
  Sparkles,
  Layers,
  Crown,
  History,
  Copy,
  Check,
} from 'lucide-react';
import { notify as toast } from '@/lib/toast';

type UserDetailProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  gender?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  phoneNumber?: string | null;
  timeZone: string;
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  whatsappNotificationsEnabled: boolean;
  createdAt: Date | string;
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
    urgency: string;
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', val);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const statusVariantMap: Record<
    string,
    'default' | 'success' | 'warning' | 'destructive' | 'neutral' | 'info'
  > = {
    TRIGGERED: 'destructive',
    ACKNOWLEDGED: 'warning',
    RESOLVED: 'success',
    CLOSED: 'neutral',
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-5">
      {/* Modern High-Contrast Tab Bar */}
      <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full h-auto p-1.5 bg-muted/80 rounded-xl border border-border/60 shadow-xs">
        <TabsTrigger
          value="overview"
          className="flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
        >
          <User className="h-3.5 w-3.5" />
          <span>Profile & Overview</span>
        </TabsTrigger>

        <TabsTrigger
          value="teams"
          className="flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
        >
          <Users className="h-3.5 w-3.5" />
          <span>Teams ({user.teamMemberships.length})</span>
        </TabsTrigger>

        <TabsTrigger
          value="schedules"
          className="flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
        >
          <Calendar className="h-3.5 w-3.5" />
          <span>On-Call ({user.layerAssignments.length})</span>
        </TabsTrigger>

        <TabsTrigger
          value="activity"
          className="flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
        >
          <Activity className="h-3.5 w-3.5" />
          <span>Activity & Routing</span>
        </TabsTrigger>
      </TabsList>

      {/* TAB 1: Profile & Overview */}
      <TabsContent value="overview" className="space-y-5 pt-1">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Identity & Personal Info */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <span>Contact & Work Information</span>
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-mono">
                  ID: {user.id.slice(0, 10)}...
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-border/40">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary/70" /> Email Address
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{user.email}</span>
                  <button
                    onClick={() => copyToClipboard(user.email, 'email')}
                    className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
                    title="Copy Email"
                  >
                    {copiedKey === 'email' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-border/40">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Phone className="h-4 w-4 text-primary/70" /> Mobile / Pager Phone
                </span>
                <div className="flex items-center gap-2">
                  {user.phoneNumber ? (
                    <>
                      <a
                        href={`tel:${user.phoneNumber}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {user.phoneNumber}
                      </a>
                      <button
                        onClick={() => copyToClipboard(user.phoneNumber!, 'phone')}
                        className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
                        title="Copy Phone"
                      >
                        {copiedKey === 'phone' ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </>
                  ) : (
                    <span className="text-muted-foreground/60 italic">Not specified</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-border/40">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary/70" /> Department
                </span>
                <span className="font-semibold text-foreground">
                  {user.department || (
                    <span className="text-muted-foreground/60 italic">Engineering</span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-border/40">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-primary/70" /> Job Title
                </span>
                <span className="font-semibold text-foreground">
                  {user.jobTitle || (
                    <span className="text-muted-foreground/60 italic">On-Call Engineer</span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-border/40">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary/70" /> Configured Timezone
                </span>
                <Badge
                  variant="outline"
                  className="font-mono text-[11px] font-semibold bg-muted/40"
                >
                  {user.timeZone || 'UTC'}
                </Badge>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary/70" /> Access & Governance
                </span>
                <span className="font-semibold text-foreground capitalize">
                  {user.role.toLowerCase()} Role Level
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Alert & Paging Delivery Channels Matrix */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <span>Paging & Notification Channels</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Channels utilized when incidents trigger escalations to this user
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 space-y-3.5">
              {/* Channel 1: Email */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-card hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-bold text-xs">Email Alerts</div>
                    <div className="text-[11px] text-muted-foreground">
                      High & critical priority incident pages
                    </div>
                  </div>
                </div>
                {user.emailNotificationsEnabled ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] font-bold gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[10px]">
                    Disabled
                  </Badge>
                )}
              </div>

              {/* Channel 2: SMS */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-card hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-bold text-xs">SMS Text Messages</div>
                    <div className="text-[11px] text-muted-foreground">
                      {user.phoneNumber ? `Paging to ${user.phoneNumber}` : 'Requires phone number'}
                    </div>
                  </div>
                </div>
                {user.smsNotificationsEnabled && user.phoneNumber ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] font-bold gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[10px]">
                    {user.phoneNumber ? 'Disabled' : 'Unconfigured'}
                  </Badge>
                )}
              </div>

              {/* Channel 3: Browser / Mobile Push */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-card hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400">
                    <Bell className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-bold text-xs">Push Notifications</div>
                    <div className="text-[11px] text-muted-foreground">
                      Mobile & browser instant alerts
                    </div>
                  </div>
                </div>
                {user.pushNotificationsEnabled ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] font-bold gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[10px]">
                    Disabled
                  </Badge>
                )}
              </div>

              {/* Channel 4: WhatsApp */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-card hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-bold text-xs">WhatsApp Direct</div>
                    <div className="text-[11px] text-muted-foreground">
                      Direct incident dispatch messages
                    </div>
                  </div>
                </div>
                {user.whatsappNotificationsEnabled && user.phoneNumber ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] font-bold gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[10px]">
                    {user.phoneNumber ? 'Disabled' : 'Unconfigured'}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* TAB 2: Teams & Lead Roles */}
      <TabsContent value="teams" className="space-y-4 pt-1">
        {user.teamMemberships.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {user.teamMemberships.map(membership => {
              const isLead =
                user.teamsLed.some(t => t.id === membership.team.id) || membership.role === 'LEAD';
              return (
                <Card
                  key={membership.id}
                  className="border-border hover:border-primary/40 transition-all hover:shadow-md group flex flex-col justify-between"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-bold group-hover:text-primary transition-colors">
                            {membership.team.name}
                          </CardTitle>
                          {isLead && (
                            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px] font-bold gap-1">
                              <Crown className="h-3 w-3 text-amber-500" /> Team Lead
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {membership.team.description || 'Dedicated incident engineering team'}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 flex items-center justify-between border-t border-border/40 py-3 mt-auto bg-muted/10">
                    <Badge variant="neutral" className="text-[10px] font-semibold uppercase">
                      Role: {membership.role}
                    </Badge>
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary gap-1 px-2"
                    >
                      <Link href={`/teams/${membership.team.id}`}>
                        <span>View Team</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed border-2 border-border/80 text-center py-12">
            <CardContent className="space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <Users className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-foreground">No Teams Assigned</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  This user is not currently a member of any incident response teams.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* TAB 3: On-Call Schedules & Rotation Layers */}
      <TabsContent value="schedules" className="space-y-4 pt-1">
        {user.layerAssignments.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {user.layerAssignments.map(assignment => (
              <Card
                key={assignment.id}
                className="border-border hover:border-primary/40 transition-all hover:shadow-md group flex flex-col justify-between"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-base font-bold group-hover:text-primary transition-colors flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary" />
                        <span>{assignment.layer.schedule.name}</span>
                      </CardTitle>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground/70" />
                        <span>
                          Layer:{' '}
                          <strong className="text-foreground">{assignment.layer.name}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 flex items-center justify-between border-t border-border/40 py-3 mt-auto bg-muted/10">
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] font-bold"
                  >
                    Active Rotation
                  </Badge>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-primary gap-1 px-2"
                  >
                    <Link href={`/schedules/${assignment.layer.schedule.id}`}>
                      <span>View Schedule</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed border-2 border-border/80 text-center py-12">
            <CardContent className="space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <Calendar className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-foreground">No On-Call Rotations</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  This user is not currently scheduled on any active on-call rotation layers.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* TAB 4: Activity & Escalation Routing */}
      <TabsContent value="activity" className="space-y-5 pt-1">
        {/* Escalation Policies Targeting This User */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
              <ShieldAlert className="h-4 w-4 text-primary" />
              <span>Targeted Escalation Policies ({user.escalationRules.length})</span>
            </h3>
          </div>

          {user.escalationRules.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {user.escalationRules.map(rule => (
                <Card
                  key={rule.id}
                  className="border-border hover:border-primary/40 transition-all p-4 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge
                        variant="outline"
                        className="bg-primary/10 text-primary border-primary/20 text-[10px] font-bold"
                      >
                        Step {rule.stepOrder + 1}
                      </Badge>
                      <Badge variant="neutral" className="text-[10px]">
                        {rule.delayMinutes === 0 ? 'Immediately' : `+${rule.delayMinutes}m delay`}
                      </Badge>
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-foreground">{rule.policy.name}</h4>
                      {rule.policy.description && (
                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                          {rule.policy.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="pt-3 mt-3 border-t border-border/40 flex justify-end">
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-primary gap-1 px-1.5"
                    >
                      <Link href={`/policies/${rule.policy.id}`}>
                        <span>View Policy</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic bg-muted/20 p-4 rounded-xl border border-border/50">
              This user is not directly targeted as a step in any escalation policies.
            </p>
          )}
        </div>

        {/* Assigned Incidents History */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Flame className="h-4 w-4 text-primary" />
              <span>Assigned Incidents ({user.assignedIncidents.length})</span>
            </h3>
            {user.assignedIncidents.length > 0 && (
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-primary gap-1">
                <Link href={`/incidents?assignee=${user.id}`}>
                  <span>View All in Incidents</span>
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>

          {user.assignedIncidents.length > 0 ? (
            <div className="border border-border rounded-xl overflow-hidden shadow-xs">
              <div className="divide-y divide-border">
                {user.assignedIncidents.map(inc => (
                  <div
                    key={inc.id}
                    className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/incidents/${inc.id}`}
                          className="font-bold text-xs hover:text-primary transition-colors truncate"
                        >
                          {inc.title}
                        </Link>
                        {inc.service && (
                          <Badge variant="outline" className="text-[10px] shrink-0 font-medium">
                            {inc.service.name}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>
                          Urgency: <strong className="text-foreground">{inc.urgency}</strong>
                        </span>
                        <span>•</span>
                        <span>Opened {new Date(inc.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={statusVariantMap[inc.status] || 'neutral'}
                        className="text-[10px] font-bold uppercase"
                      >
                        {inc.status}
                      </Badge>
                      <Button asChild variant="outline" size="sm" className="h-7 text-xs px-2.5">
                        <Link href={`/incidents/${inc.id}`}>
                          <span>Details</span>
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic bg-muted/20 p-4 rounded-xl border border-border/50">
              No recent incidents assigned to this user.
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
