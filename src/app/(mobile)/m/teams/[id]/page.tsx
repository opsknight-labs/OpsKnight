import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { getDefaultAvatar } from '@/lib/avatar';
import MobileCard from '@/components/mobile/MobileCard';
import { ArrowLeft } from 'lucide-react';
import { activeIncidentStatuses } from '@/lib/incident-status';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileTeamDetailPage({ params }: PageProps) {
  const { id } = await params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              avatarUrl: true,
              gender: true,
            },
          },
        },
      },
      _count: {
        select: {
          incidents: {
            where: { status: { in: activeIncidentStatuses() } },
          },
        },
      },
    },
  });

  if (!team) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Header */}
      <div className="space-y-3">
        <Link
          href="/m/teams"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Teams
        </Link>

        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-lg font-bold text-white dark:from-slate-200 dark:to-slate-50 dark:text-slate-900">
            {team.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-lg font-bold text-[color:var(--text-primary)]">{team.name}</h1>
            {team.description && (
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">{team.description}</p>
            )}
            <div className="mt-2 text-[11px] text-[color:var(--text-muted)]">
              👥 {team.members.length} member{team.members.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-3">
        {/* Team Members */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            Members
          </h3>
          <div className="flex flex-col gap-2">
            {team.members.map(member => (
              <MobileCard key={member.id} padding="sm">
                <div className="flex items-center gap-3">
                  <MobileAvatar
                    name={member.user.name || member.user.email}
                    src={
                      member.user.avatarUrl || getDefaultAvatar(member.user.gender, member.user.id)
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                      {member.user.name || 'Unknown'}
                    </div>
                    <div className="truncate text-[11px] text-[color:var(--text-muted)]">
                      {member.role || 'Member'}
                    </div>
                  </div>
                </div>
              </MobileCard>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
