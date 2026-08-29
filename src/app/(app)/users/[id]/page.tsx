import prisma from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/rbac';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  ArrowLeft,
  Mail,
  Building2,
  Briefcase,
  Clock,
  Calendar,
  Users,
  ShieldAlert,
  Flame,
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
  const totalTeams = user.teamMemberships.length;
  const totalSchedules = user.layerAssignments.length;
  const totalPolicies = user.escalationRules.length;

  const localTimeStr = formatLocalTimeInTz(user.timeZone);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <header className="space-y-4">
        {/* Breadcrumb matching Schedules and Policies */}
        <Link
          href="/users"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Users</span>
          <span className="opacity-40">/</span>
          <span className="font-medium text-foreground">{user.name}</span>
        </Link>

        {/* Header Hero Banner matching standard OpsKnight design */}
        <div className="relative overflow-hidden rounded-lg bg-gradient-to-r from-primary to-primary/80 p-4 text-primary-foreground shadow-lg md:p-6">
          <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-primary-foreground/[0.08] blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            {/* Left: Avatar and Identity */}
            <div className="flex items-start gap-4">
              <UserAvatar
                userId={user.id}
                name={user.name}
                avatarUrl={user.avatarUrl}
                gender={user.gender}
                size="xl"
                showOnlineStatus={user.status === 'ACTIVE'}
                className="shrink-0 ring-2 ring-primary-foreground/20 rounded-full"
              />

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/75">
                    User Profile
                  </p>
                  <Badge
                    variant="outline"
                    size="xs"
                    className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 uppercase font-bold text-[10px]"
                  >
                    {user.role}
                  </Badge>
                  {user.status === 'ACTIVE' ? (
                    <Badge
                      variant="outline"
                      size="xs"
                      className="bg-emerald-500/20 text-emerald-100 border-emerald-400/30 font-medium text-[10px]"
                    >
                      Active
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      size="xs"
                      className="bg-rose-500/20 text-rose-100 border-rose-400/30 font-medium text-[10px]"
                    >
                      {user.status}
                    </Badge>
                  )}
                  {isSelf && (
                    <Badge
                      variant="outline"
                      size="xs"
                      className="bg-primary-foreground/10 text-primary-foreground/80 border-primary-foreground/20 text-[10px]"
                    >
                      You
                    </Badge>
                  )}
                </div>

                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-primary-foreground md:text-3xl">
                  {user.name}
                </h1>

                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-primary-foreground/85">
                  <a
                    href={`mailto:${user.email}`}
                    className="flex items-center gap-1.5 hover:text-white hover:underline transition-colors"
                  >
                    <Mail className="h-3.5 w-3.5 opacity-80" />
                    <span>{user.email}</span>
                  </a>

                  {user.jobTitle && (
                    <span className="flex items-center gap-1.5">
                      <Briefcase className="h-3.5 w-3.5 opacity-80" />
                      <span>{user.jobTitle}</span>
                    </span>
                  )}

                  {user.department && (
                    <span className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 opacity-80" />
                      <span>{user.department}</span>
                    </span>
                  )}

                  <span className="flex items-center gap-1.5 bg-primary-foreground/10 px-2 py-0.5 rounded border border-primary-foreground/15">
                    <Clock className="h-3 w-3 opacity-80" />
                    <span>{localTimeStr}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Right: 4 Summary Metric Capsules & Header Action */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 p-1.5 backdrop-blur-sm lg:min-w-[360px]">
                <div className="min-w-0 rounded-md px-2.5 py-1.5 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                    Incidents
                  </p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-sm font-semibold text-primary-foreground">
                    <Flame className="h-3.5 w-3.5" /> {totalIncidents}
                  </p>
                </div>
                <div className="min-w-0 rounded-md border-l border-primary-foreground/20 px-2.5 py-1.5 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                    Teams
                  </p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-sm font-semibold text-primary-foreground">
                    <Users className="h-3.5 w-3.5" /> {totalTeams}
                  </p>
                </div>
                <div className="min-w-0 rounded-md border-l border-primary-foreground/20 px-2.5 py-1.5 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                    On-Call
                  </p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-sm font-semibold text-primary-foreground">
                    <Calendar className="h-3.5 w-3.5" /> {totalSchedules}
                  </p>
                </div>
                <div className="min-w-0 rounded-md border-l border-primary-foreground/20 px-2.5 py-1.5 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                    Policies
                  </p>
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-sm font-semibold text-primary-foreground">
                    <ShieldAlert className="h-3.5 w-3.5" /> {totalPolicies}
                  </p>
                </div>
              </div>

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
        </div>
      </header>

      {/* 4-Tab Full-Width Profile Workspace matching standard tab styling */}
      <UserDetailTabs user={user} canManage={canManage} defaultTab={defaultTab} />
    </main>
  );
}
