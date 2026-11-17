import prisma from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { FileText } from 'lucide-react';
import { appRoutes } from '@/lib/app-routes';
import EmptyState from '@/components/patterns/EmptyState';
import RelativeTime from '@/components/patterns/RelativeTime';
import {
  MobileListCard,
  MobileListMeta,
  MobileListRow,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import { postmortemStatusMeta } from '@/components/mobile/mobile-status-meta';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { getUserPermissions } from '@/lib/rbac';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

export default async function MobilePostmortemsPage() {
  await requirePageAccess('/m/postmortems');
  const [context, permissions] = await Promise.all([
    getRequestActorContext(),
    getUserPermissions(),
  ]);
  if (!context) redirect(appRoutes.login('mobile', '/m/postmortems'));

  const postmortemAccess = postmortemReadWhere(context.actor);
  const postmortems = await prisma.postmortem.findMany({
    where: permissions.isResponderOrAbove
      ? postmortemAccess
      : { AND: [postmortemAccess, { status: 'PUBLISHED' }] },
    orderBy: { createdAt: 'desc' },
    include: {
      incident: {
        select: {
          title: true,
          service: { select: { name: true } },
        },
      },
      createdBy: { select: { name: true, email: true } },
    },
    take: 20,
  });

  return (
    <div className="responsive-page space-y-4">
      <MobileListMeta
        trailing={postmortems.length === 20 ? 'Showing the 20 most recent' : undefined}
      >
        {postmortems.length} {postmortems.length === 1 ? 'postmortem' : 'postmortems'}
      </MobileListMeta>

      {postmortems.length === 0 ? (
        <EmptyState
          icon={<FileText aria-hidden="true" />}
          title="No postmortems yet"
          description="After an incident is resolved, start a postmortem from its detail page to capture the root cause and follow-ups."
          size="sm"
        />
      ) : (
        <MobileListCard label="Postmortems">
          {postmortems.map(postmortem => {
            const status = postmortemStatusMeta(postmortem.status);
            return (
              <MobileListRow
                key={postmortem.id}
                href={`/m/postmortems/${postmortem.id}`}
                titleLines={2}
                badges={
                  <MobileToneBadge tone={status.tone} icon={status.icon}>
                    {status.label}
                  </MobileToneBadge>
                }
                meta={<RelativeTime date={postmortem.createdAt} />}
                title={postmortem.incident.title}
                subtitle={`${postmortem.incident.service.name} · ${
                  postmortem.createdBy?.name || postmortem.createdBy?.email || 'Deleted user'
                }`}
              />
            );
          })}
        </MobileListCard>
      )}
    </div>
  );
}
