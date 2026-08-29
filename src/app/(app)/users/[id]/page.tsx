import prisma from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/rbac';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  ArrowLeft,
  Mail,
  Building2,
  Briefcase,
  Globe,
  Clock,
  Calendar,
  Users,
  ShieldAlert,
  Activity,
  CheckCircle2,
  Copy,
  ExternalLink,
} from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import UserDetailTabs from '@/components/users/UserDetailTabs';
import UserProfileHeaderActions from '@/components/users/UserProfileHeaderActions';
import { updateUserProfile } from '../actions';

export const revalidate = 0;

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
};

const roleBadgeColors: Record<string, string> = {
  ADMIN: 'bg-rose-500/20 text-rose-100 border-rose-400/30',
  RESPONDER: 'bg-indigo-500/20 text-indigo-100 border-indigo-400/30',
  AUDITOR: 'bg-amber-500/20 text-amber-100 border-amber-400/30',
  USER: 'bg-sky-500/20 text-sky-100 border-sky-400/30',
};

function formatLocalTimeInTz(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZoneName: 'short',
    }).format(new Date());
  } catch {
    return 'UTC';
  }
}

export default async function UserDetailPage({ params, searchParams }: UserDetailPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const defaultTab = resolvedSearchParams?.tab || 'overview';

  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect(`/login?callbackUrl=/users/${id}`);
  }

  const [user, permissions, currentUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      include: {
        teamMemberships: {
          include: {
            team: {
              select: { id: true, name: true, description: true },
            },
          },
          orderBy: { team: { name: 'asc' } },
        },
        teamsLed: {
          select: { id: true, name: true },
        },
        layerAssignments: {
          include: {
            layer: {
              include: {
                schedule: {
                  select: { id: true, name: true, timeZone: true },
                },
              },
            },
          },
        },
        escalationRules: {
          include: {
            policy: {
              select: { id: true, name: true, description: true },
            },
          },
          orderBy: { stepOrder: 'asc' },
        },
        assignedIncidents: {
          select: {
            id: true,
            title: true,
            status: true,
            urgency: true,
            priority: true,
            createdAt: true,
            service: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 15,
        },
        auditLogs: {
          select: {
            id: true,
            action: true,
            createdAt: true,
            details: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 15,
        },
      },
    }),
    getUserPermissions(),
    prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    }),
  ]);

  if (!user) {
    notFound();
  }

  const isSelf = currentUser?.id === user.id;
  const canManage = permissions.isAdmin || isSelf;
  const canManageRole = permissions.isAdmin;

  // Compute summary stats
  const totalIncidents = user.assignedIncidents.length;
  const resolvedIncidentsCount = user.assignedIncidents.filter(
    i => (i.status as string) === 'RESOLVED' || (i.status as string) === 'CLOSED'
  ).length;
  const totalTeams = user.teamMemberships.length;
  const teamsLedCount = user.teamsLed.length;
  const totalSchedules = user.layerAssignments.length;
  const totalPolicies = user.escalationRules.length;

  const localTimeStr = formatLocalTimeInTz(user.timeZone);
  const memberSince = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
  }).format(new Date(user.createdAt));

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      {/* Top Breadcrumb Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/users"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors group"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to Users Directory</span>
        </Link>
      </div>

      {/* Main Profile Cover & Hero Card */}
      <div className="bg-gradient-to-r from-primary via-primary/95 to-primary/80 text-white rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        {/* Ambient background glow & radial highlights */}
        <div className="absolute -right-16 -bottom-16 w-80 h-80 rounded-full bg-white/10 pointer-events-none blur-3xl" />
        <div className="absolute left-1/3 -top-12 w-64 h-64 rounded-full bg-white/5 pointer-events-none blur-2xl" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          {/* User Bio & Avatar Area */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
            <div className="relative shrink-0">
              <UserAvatar
                userId={user.id}
                name={user.name}
                avatarUrl={user.avatarUrl}
                gender={user.gender}
                size="xl"
                className="h-20 w-20 sm:h-24 sm:w-24 text-2xl font-bold ring-4 ring-white/25 shadow-xl"
              />
              {user.status === 'ACTIVE' && (
                <span
                  className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-emerald-400 ring-2 ring-primary ring-offset-1 shadow-xs"
                  title="Account Active"
                />
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                  {user.name}
                </h1>
                <Badge
                  variant="outline"
                  className={`${roleBadgeColors[user.role] || 'bg-white/10 text-white border-white/20'} text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5`}
                >
                  {user.role}
                </Badge>
                {user.status === 'ACTIVE' ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/20 text-emerald-100 border-emerald-400/30 text-[11px] font-medium gap-1 px-2 py-0.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                    Active Member
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-rose-500/20 text-rose-100 border-rose-400/30 text-[11px] font-medium px-2 py-0.5"
                  >
                    {user.status}
                  </Badge>
                )}
                {isSelf && (
                  <Badge
                    variant="outline"
                    className="bg-white/15 text-white/90 border-white/20 text-[10px]"
                  >
                    Your Profile
                  </Badge>
                )}
              </div>

              {/* Subtitle Details: Email, Job Title, Dept, Timezone, Tenure */}
              <div className="flex items-center gap-y-1.5 gap-x-4 text-xs text-white/85 flex-wrap">
                <a
                  href={`mailto:${user.email}`}
                  className="flex items-center gap-1.5 hover:text-white hover:underline transition-colors"
                >
                  <Mail className="h-3.5 w-3.5 opacity-75" />
                  <span>{user.email}</span>
                </a>

                {user.jobTitle && (
                  <span className="flex items-center gap-1.5">
                    <Briefcase className="h-3.5 w-3.5 opacity-75" />
                    <span>{user.jobTitle}</span>
                  </span>
                )}

                {user.department && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 opacity-75" />
                    <span>{user.department}</span>
                  </span>
                )}

                <span className="flex items-center gap-1.5 bg-white/10 px-2 py-0.5 rounded-md border border-white/15">
                  <Clock className="h-3 w-3 opacity-75" />
                  <span>{localTimeStr}</span>
                </span>

                <span className="flex items-center gap-1.5 opacity-75">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Joined {memberSince}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Profile Actions Toolbar */}
          <div className="shrink-0 w-full lg:w-auto flex items-center gap-2">
            <UserProfileHeaderActions
              user={{
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department,
                jobTitle: user.jobTitle,
                timeZone: user.timeZone,
                phoneNumber: user.phoneNumber,
                emailNotificationsEnabled: user.emailNotificationsEnabled,
                smsNotificationsEnabled: user.smsNotificationsEnabled,
                pushNotificationsEnabled: user.pushNotificationsEnabled,
                whatsappNotificationsEnabled: user.whatsappNotificationsEnabled,
              }}
              canManage={canManage}
              canManageRole={canManageRole}
              updateProfile={updateUserProfile}
            />
          </div>
        </div>

        {/* 4-Stat Metric Capsule Matrix */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-6 mt-6 border-t border-white/15 relative z-10">
          <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
            <CardContent className="p-3.5 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-black tracking-tight">{totalIncidents}</div>
              <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                {resolvedIncidentsCount > 0
                  ? `${resolvedIncidentsCount} Resolved`
                  : 'Assigned Incidents'}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
            <CardContent className="p-3.5 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-black tracking-tight text-emerald-200">
                {totalTeams}
              </div>
              <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                {teamsLedCount > 0
                  ? `${teamsLedCount} Lead Role${teamsLedCount > 1 ? 's' : ''}`
                  : 'Team Memberships'}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
            <CardContent className="p-3.5 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-black tracking-tight text-amber-200">
                {totalSchedules}
              </div>
              <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                On-Call Rotations
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/10 border-white/20 backdrop-blur-md text-white shadow-xs">
            <CardContent className="p-3.5 sm:p-4 text-center">
              <div className="text-xl sm:text-2xl font-black tracking-tight text-sky-200">
                {totalPolicies}
              </div>
              <div className="text-[10px] sm:text-xs text-white/75 font-medium mt-0.5">
                Escalation Steps
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 4-Tab Full-Width Profile Workspace */}
      <UserDetailTabs user={user} canManage={canManage} defaultTab={defaultTab} />
    </div>
  );
}
