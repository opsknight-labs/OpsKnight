import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { AlertTriangle, CheckCircle2, UsersRound } from 'lucide-react';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  MobileDetailHeader,
  MobileIconTile,
  MobileListCard,
  MobileListRow,
  MobileSection,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { assertCanViewTeam } from '@/lib/rbac';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileTeamDetailPage({ params }: PageProps) {
  await requirePageAccess('/m/teams/[id]');
  const { id } = await params;
  await assertCanViewTeam(id);

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

  const activeIncidents = team._count.incidents;

  return (
    <div className="responsive-page space-y-4">
      <MobileDetailHeader
        leading={<MobileIconTile icon={UsersRound} size="lg" />}
        title={team.name}
        badges={
          activeIncidents > 0 ? (
            <MobileToneBadge tone="critical" icon={AlertTriangle}>
              {activeIncidents} active {activeIncidents === 1 ? 'incident' : 'incidents'}
            </MobileToneBadge>
          ) : (
            <MobileToneBadge tone="ok" icon={CheckCircle2}>
              No active incidents
            </MobileToneBadge>
          )
        }
        description={team.description || undefined}
        facts={[
          { label: 'Members', value: team.members.length },
          { label: 'Active incidents', value: activeIncidents },
        ]}
      />

      <MobileSection id="team-members" title="Members" count={team.members.length}>
        {team.members.length === 0 ? (
          <EmptyState
            icon={<UsersRound aria-hidden="true" />}
            title="No members yet"
            description="Add responders to this team from the desktop workspace so escalations reach them."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <MobileListCard>
            {team.members.map(member => (
              <MobileListRow
                key={member.id}
                leading={
                  <MobileAvatar
                    name={member.user.name || member.user.email}
                    src={
                      member.user.avatarUrl || getDefaultAvatar(member.user.gender, member.user.id)
                    }
                  />
                }
                title={member.user.name || 'Unknown'}
                subtitle={member.user.email}
                trailing={
                  <MobileToneBadge tone={null}>
                    {member.role
                      ? member.role.charAt(0) + member.role.slice(1).toLowerCase()
                      : 'Member'}
                  </MobileToneBadge>
                }
              />
            ))}
          </MobileListCard>
        )}
      </MobileSection>
    </div>
  );
}
