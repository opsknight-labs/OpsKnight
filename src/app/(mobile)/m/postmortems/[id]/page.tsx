import prisma from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import { FileText, Siren } from 'lucide-react';
import { appRoutes } from '@/lib/app-routes';
import {
  MobileDetailHeader,
  MobileIconTile,
  MobileListCard,
  MobileListRow,
  MobileSection,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import { postmortemStatusMeta } from '@/components/mobile/mobile-status-meta';
import RelativeTime from '@/components/patterns/RelativeTime';
import { getUserPermissions } from '@/lib/rbac';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobilePostmortemDetailPage({ params }: PageProps) {
  await requirePageAccess('/m/postmortems/[id]');
  const { id } = await params;
  const [context, permissions] = await Promise.all([
    getRequestActorContext(),
    getUserPermissions(),
  ]);
  if (!context) redirect(appRoutes.login('mobile', `/m/postmortems/${encodeURIComponent(id)}`));

  const postmortemAccess = postmortemReadWhere(context.actor);
  const pm = await prisma.postmortem.findFirst({
    where: {
      AND: [
        { id },
        postmortemAccess,
        ...(permissions.isResponderOrAbove ? [] : [{ status: 'PUBLISHED' as const }]),
      ],
    },
    include: {
      incident: {
        select: {
          id: true,
          title: true,
          service: { select: { name: true } },
          createdAt: true,
          resolvedAt: true,
        },
      },
      createdBy: { select: { name: true, email: true } },
    },
  });

  if (!pm) {
    notFound();
  }

  const status = postmortemStatusMeta(pm.status);

  return (
    <div className="responsive-page space-y-4">
      <MobileDetailHeader
        leading={<MobileIconTile icon={FileText} tone={status.tone} size="lg" />}
        title={pm.incident.title}
        badges={
          <MobileToneBadge tone={status.tone} icon={status.icon}>
            {status.label}
          </MobileToneBadge>
        }
        facts={[
          {
            label: 'Author',
            value: pm.createdBy?.name || pm.createdBy?.email || 'Deleted user',
          },
          { label: 'Service', value: pm.incident.service.name },
          { label: 'Created', value: <RelativeTime date={pm.createdAt} /> },
          {
            label: 'Incident resolved',
            value: <RelativeTime date={pm.incident.resolvedAt} fallback="Not resolved" />,
          },
        ]}
      />

      <MobileSection id="postmortem-summary" title="Executive summary">
        <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
          {pm.summary ? (
            <p className="whitespace-pre-wrap break-words">{pm.summary}</p>
          ) : (
            <p className="text-muted-foreground">No summary yet. The author adds it on desktop.</p>
          )}
        </div>
      </MobileSection>

      <MobileSection id="postmortem-root-cause" title="Root cause">
        <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
          {pm.rootCause ? (
            <p className="whitespace-pre-wrap break-words">{pm.rootCause}</p>
          ) : (
            <p className="text-muted-foreground">No root cause analysis recorded yet.</p>
          )}
        </div>
      </MobileSection>

      <MobileListCard label="Related incident">
        <MobileListRow
          href={`/m/incidents/${pm.incident.id}`}
          leading={<MobileIconTile icon={Siren} />}
          title="Open the incident"
          subtitle="Timeline, notes and responders"
        />
      </MobileListCard>
    </div>
  );
}
