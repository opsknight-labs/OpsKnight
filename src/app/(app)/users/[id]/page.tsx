import prisma from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/rbac';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  ArrowLeft,
  User,
  Shield,
  Building2,
  Briefcase,
  Mail,
  Phone,
  Globe,
  Clock,
  Calendar,
  Users,
  ShieldAlert,
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
  ADMIN: 'bg-rose-50 text-rose-700 border-rose-200',
  RESPONDER: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  AUDITOR: 'bg-amber-50 text-amber-700 border-amber-200',
  USER: 'bg-sky-50 text-sky-700 border-sky-200',
};

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
          take: 10,
        },
        auditLogs: {
          select: {
            id: true,
            action: true,
            createdAt: true,
            details: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
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

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6">
      {/* Top Breadcrumb / Back Link */}
      <div className="flex items-center justify-between">
        <Link
          href="/users"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Users Directory
        </Link>
      </div>

      {/* Hero Profile Banner */}
      <div className="bg-gradient-to-r from-primary via-primary/95 to-primary/80 text-white rounded-2xl p-6 sm:p-7 shadow-lg relative overflow-hidden">
        <div className="absolute -right-12 -bottom-12 w-64 h-64 rounded-full bg-white/5 pointer-events-none blur-2xl" />
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div className="flex items-start sm:items-center gap-4">
            <UserAvatar
              userId={user.id}
              name={user.name}
              avatarUrl={user.avatarUrl}
              gender={user.gender}
              size="lg"
              className="ring-4 ring-white/20 shadow-md shrink-0"
            />
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  {user.name}
                </h1>
                <Badge
                  variant="outline"
                  className={`${roleBadgeColors[user.role] || 'bg-white/10 text-white border-white/20'} text-[10px] font-semibold uppercase tracking-wider`}
                >
                  {user.role}
                </Badge>
                {user.status === 'ACTIVE' ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/20 text-emerald-100 border-emerald-400/30 text-[10px]"
                  >
                    Active
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-rose-500/20 text-rose-100 border-rose-400/30 text-[10px]"
                  >
                    {user.status}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-4 text-xs text-white/80 flex-wrap">
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 opacity-70" /> {user.email}
                </span>
                {user.jobTitle && (
                  <span className="flex items-center gap-1">
                    <Briefcase className="h-3.5 w-3.5 opacity-70" /> {user.jobTitle}
                  </span>
                )}
                {user.department && (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5 opacity-70" /> {user.department}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Globe className="h-3.5 w-3.5 opacity-70" /> {user.timeZone}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
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
      </div>

      {/* 4-Tab Full-Width Workspace */}
      <UserDetailTabs user={user} canManage={canManage} defaultTab={defaultTab} />
    </div>
  );
}
