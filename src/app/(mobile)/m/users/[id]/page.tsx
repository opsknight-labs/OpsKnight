import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { getDefaultAvatar } from '@/lib/avatar';
import MobileCard from '@/components/mobile/MobileCard';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getCurrentUser } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileUserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  if (viewer.role !== 'ADMIN' && viewer.id !== id) notFound();

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      teamMemberships: {
        include: {
          team: { select: { id: true, name: true } },
        },
      },
      assignedIncidents: {
        where: { status: { in: activeIncidentStatuses() } },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          service: { select: { name: true } },
        },
      },
      _count: {
        select: {
          assignedIncidents: { where: { status: { in: activeIncidentStatuses() } } },
        },
      },
    },
  });

  if (!user) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Back Button */}
      <Link
        href="/m/users"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Users
      </Link>

      {/* User Header */}
      <MobileCard padding="lg" className="flex items-center gap-4">
        <MobileAvatar
          name={user.name || user.email}
          size="lg"
          src={user.avatarUrl || getDefaultAvatar(user.gender, user.id)}
        />
        <div className="flex-1">
          <h1 className="text-lg font-bold text-[color:var(--text-primary)]">
            {user.name || 'Unknown User'}
          </h1>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">{user.email}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span
              className={`rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                user.role === 'ADMIN'
                  ? 'bg-[color:var(--badge-warning-bg)] text-[color:var(--badge-warning-text)]'
                  : 'bg-[color:var(--badge-neutral-bg)] text-[color:var(--badge-neutral-text)]'
              }`}
            >
              {user.role.toLowerCase()}
            </span>
            <span
              className={`rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                user.status === 'ACTIVE'
                  ? 'bg-[color:var(--badge-success-bg)] text-[color:var(--badge-success-text)]'
                  : 'bg-[color:var(--badge-error-bg)] text-[color:var(--badge-error-text)]'
              }`}
            >
              {user.status}
            </span>
          </div>
        </div>
      </MobileCard>

      {/* Teams Section */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
          Teams ({user.teamMemberships.length})
        </h3>
        <div className="flex flex-col gap-2">
          {user.teamMemberships.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No team memberships</p>
          ) : (
            user.teamMemberships.map(membership => (
              <Link
                key={membership.id}
                href={`/m/teams/${membership.team.id}`}
                className="no-underline"
              >
                <MobileCard padding="sm" className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                      {membership.team.name}
                    </div>
                    <div className="text-[11px] text-[color:var(--text-muted)]">
                      {membership.role}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[color:var(--text-muted)]" />
                </MobileCard>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Active Incidents Section */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Active Incidents ({user._count.assignedIncidents})
        </h3>
        <div className="flex flex-col gap-2">
          {user.assignedIncidents.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No active incidents</p>
          ) : (
            user.assignedIncidents.map(incident => (
              <Link key={incident.id} href={`/m/incidents/${incident.id}`} className="no-underline">
                <MobileCard padding="sm" className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                      {incident.title}
                    </div>
                    <div className="mt-1 text-[11px] text-[color:var(--text-muted)]">
                      {incident.service.name} • {incident.status}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[color:var(--text-muted)]" />
                </MobileCard>
              </Link>
            ))
          )}
        </div>
        {user._count.assignedIncidents > user.assignedIncidents.length && (
          <p className="text-[11px] text-[color:var(--text-muted)]">
            Showing {user.assignedIncidents.length} of {user._count.assignedIncidents}
          </p>
        )}
      </div>
    </div>
  );
}
