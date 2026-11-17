import prisma from '@/lib/prisma';
import { redirect, notFound } from 'next/navigation';
import { CheckCircle2, UsersRound } from 'lucide-react';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { appRoutes } from '@/lib/app-routes';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  MobileDetailHeader,
  MobileIconTile,
  MobileIncidentRow,
  MobileListCard,
  MobileListRow,
  MobileSection,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { assertCanViewUser } from '@/lib/rbac';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileUserDetailPage({ params }: PageProps) {
  await requirePageAccess('/m/users/[id]');
  const { id } = await params;
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', `/m/users/${id}`));
  await assertCanViewUser(id);

  const incidentAccess = incidentReadWhere(context.actor);

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      teamMemberships: {
        include: {
          team: { select: { id: true, name: true } },
        },
      },
      assignedIncidents: {
        where: { AND: [incidentAccess, { status: { in: activeIncidentStatuses() } }] },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          urgency: true,
          createdAt: true,
          service: { select: { name: true } },
        },
      },
      _count: {
        select: {
          assignedIncidents: {
            where: { AND: [incidentAccess, { status: { in: activeIncidentStatuses() } }] },
          },
        },
      },
    },
  });

  if (!user) {
    notFound();
  }

  const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

  return (
    <div className="responsive-page space-y-4">
      <MobileDetailHeader
        leading={
          <MobileAvatar
            name={user.name || user.email}
            size="lg"
            src={user.avatarUrl || getDefaultAvatar(user.gender, user.id)}
          />
        }
        title={user.name || 'Unknown user'}
        description={<span className="break-all">{user.email}</span>}
        badges={
          <>
            <MobileToneBadge tone={null}>{titleCase(user.role)}</MobileToneBadge>
            <MobileToneBadge tone={user.status === 'ACTIVE' ? 'ok' : 'elevated'}>
              {titleCase(user.status)}
            </MobileToneBadge>
          </>
        }
        facts={[
          { label: 'Teams', value: user.teamMemberships.length },
          { label: 'Active incidents', value: user._count.assignedIncidents },
        ]}
      />

      <MobileSection id="user-teams" title="Teams" count={user.teamMemberships.length}>
        {user.teamMemberships.length === 0 ? (
          <EmptyState
            icon={<UsersRound aria-hidden="true" />}
            title="Not on any team"
            description="Team membership decides which escalations reach this person."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <MobileListCard>
            {user.teamMemberships.map(membership => (
              <MobileListRow
                key={membership.id}
                href={`/m/teams/${membership.team.id}`}
                leading={<MobileIconTile icon={UsersRound} />}
                title={membership.team.name}
                subtitle={titleCase(membership.role)}
              />
            ))}
          </MobileListCard>
        )}
      </MobileSection>

      <MobileSection
        id="user-incidents"
        title="Assigned active incidents"
        count={user._count.assignedIncidents}
        description={
          user._count.assignedIncidents > user.assignedIncidents.length
            ? `Showing the latest ${user.assignedIncidents.length}`
            : undefined
        }
      >
        {user.assignedIncidents.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden="true" />}
            title="No active incidents assigned"
            description="Incidents assigned to this person show up here until they are resolved."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <MobileListCard>
            {user.assignedIncidents.map(incident => (
              <MobileIncidentRow
                key={incident.id}
                incident={{ ...incident, serviceName: incident.service.name }}
              />
            ))}
          </MobileListCard>
        )}
      </MobileSection>
    </div>
  );
}
