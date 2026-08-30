import prisma from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { Badge } from '@/components/ui/shadcn/badge';
import {
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
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
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
  const viewer = await getCurrentUser();
  if (viewer.role !== 'ADMIN' && viewer.id !== id) {
    notFound();
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

  // Transform auditLogs.details to match UserDetailProfile type
  const transformedUser = {
    ...user,
    auditLogs: user.auditLogs.map(log => ({
      ...log,
      details:
        log.details === null
          ? null
          : typeof log.details === 'object'
            ? (log.details as Record<string, unknown>)
            : JSON.stringify(log.details),
    })),
  };

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBanner
        breadcrumb={{
          label: 'Users',
          href: '/users',
          current: user.name,
        }}
        tag="User Profile"
        title={user.name}
        icon={
          <UserAvatar
            userId={user.id}
            name={user.name}
            avatarUrl={user.avatarUrl}
            gender={user.gender}
            size="xl"
            showOnlineStatus={user.status === 'ACTIVE'}
            className="shrink-0 ring-2 ring-primary-foreground/20 rounded-full"
          />
        }
        badges={
          <>
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
          </>
        }
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
        }
        stats={[
          {
            label: 'Incidents',
            value: totalIncidents,
            icon: <Flame className="h-3.5 w-3.5" />,
          },
          {
            label: 'Teams',
            value: totalTeams,
            icon: <Users className="h-3.5 w-3.5" />,
          },
          {
            label: 'On-Call',
            value: totalSchedules,
            icon: <Calendar className="h-3.5 w-3.5" />,
          },
          {
            label: 'Policies',
            value: totalPolicies,
            icon: <ShieldAlert className="h-3.5 w-3.5" />,
          },
        ]}
        actions={
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
        }
      />

      {/* 4-Tab Full-Width Profile Workspace */}
      <UserDetailTabs user={transformedUser} canManage={canManage} defaultTab={defaultTab} />
    </main>
  );
}
