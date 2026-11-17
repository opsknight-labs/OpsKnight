import MobileAutomationPanel from '@/components/automation/MobileAutomationPanel';
import { hasCapability } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AlertTriangle, ArrowRight, CheckCircle2, Plus, Server } from 'lucide-react';
import { appRoutes } from '@/lib/app-routes';
import { Button } from '@/components/ui/shadcn/button';
import MobileTime from '@/components/mobile/MobileTime';
import {
  MobileDetailHeader,
  MobileIconTile,
  MobileIncidentRow,
  MobileListCard,
  MobileSection,
  MobileToneBadge,
  mobileSectionLinkClass,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { buildIncidentListHref } from '@/lib/incident-links';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { requirePageAccess } from '@/lib/access/server';
import { assertCanModifyService } from '@/lib/rbac';
import {
  listServiceMaintenanceOverview,
  maintenanceWindowPhase,
} from '@/lib/service-maintenance/windows';
import MobileServiceMaintenance, {
  type MobileMaintenanceWindow,
} from '@/components/mobile/MobileServiceMaintenance';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
};

export default async function MobileServiceDetailPage({ params, searchParams }: PageProps) {
  await requirePageAccess('/m/services/[id]');
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', '/m/services'));

  const { id } = await params;
  const incidentAccess = incidentReadWhere(context.actor);
  const service = await prisma.service.findFirst({
    where: { AND: [serviceReadWhere(context.actor), { id }] },
    include: {
      policy: true,
      automationConfig: {
        select: { mode: true, activeVersion: { select: { versionNumber: true } } },
      },
      incidents: {
        where: {
          AND: [incidentAccess, { status: { in: activeIncidentStatuses() } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          urgency: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          incidents: {
            where: {
              AND: [incidentAccess, { status: { in: activeIncidentStatuses() } }],
            },
          },
        },
      },
    },
  });

  if (!service) notFound();
  if ((await searchParams)?.tab === 'automation') redirect(`/m/services/${service.id}/automation`);
  const isOperational = service._count.incidents === 0;

  // Same check as the desktop service page: managers are whoever may modify the service.
  let canManageService = false;
  try {
    await assertCanModifyService(service.id);
    canManageService = true;
  } catch {
    // Viewable, but this user cannot change the service.
  }
  const now = new Date();
  const maintenanceWindows: MobileMaintenanceWindow[] = [];
  for (const w of await listServiceMaintenanceOverview(service.id, now)) {
    const phase = maintenanceWindowPhase(w, now);
    if (phase === 'ENDED') continue;
    maintenanceWindows.push({
      id: w.id,
      title: w.title,
      phase,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      heldCount: w._count.heldIncidents,
    });
  }

  return (
    <div className="responsive-page space-y-4">
      <MobileDetailHeader
        leading={
          <MobileIconTile icon={Server} tone={isOperational ? 'ok' : 'critical'} size="lg" />
        }
        title={service.name}
        badges={
          isOperational ? (
            <MobileToneBadge tone="ok" icon={CheckCircle2}>
              Operational
            </MobileToneBadge>
          ) : (
            <MobileToneBadge tone="critical" icon={AlertTriangle}>
              Impacted
            </MobileToneBadge>
          )
        }
        description={service.description || undefined}
        facts={[
          { label: 'Active incidents', value: service._count.incidents },
          { label: 'Escalation policy', value: service.policy?.name || 'None' },
          { label: 'Created', value: <MobileTime value={service.createdAt} format="date" /> },
        ]}
        actions={
          <Button asChild size="lg" className="h-11 w-full rounded-xl">
            <Link href={`/m/incidents/create?serviceId=${service.id}`}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New incident
            </Link>
          </Button>
        }
      />

      <MobileSection
        id="service-incidents"
        title="Active incidents"
        count={service._count.incidents}
        action={
          service.incidents.length > 0 ? (
            <Link
              href={buildIncidentListHref({
                basePath: '/m/incidents',
                filter: 'all_open',
                serviceId: service.id,
              })}
              className={mobileSectionLinkClass}
            >
              View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : undefined
        }
      >
        {service.incidents.length > 0 ? (
          <MobileListCard>
            {service.incidents.map(incident => (
              <MobileIncidentRow key={incident.id} incident={incident} showService={false} />
            ))}
          </MobileListCard>
        ) : (
          <EmptyState
            icon={<CheckCircle2 aria-hidden="true" />}
            title="No active incidents"
            description="This service is quiet. Alerts routed here open incidents you can act on."
            size="sm"
            headingLevel="h3"
          />
        )}
      </MobileSection>

      <MobileServiceMaintenance
        serviceId={service.id}
        canManage={canManageService}
        windows={maintenanceWindows}
      />
      {hasCapability(context.actor.role, 'automation.read') && (
        <MobileAutomationPanel
          serviceId={service.id}
          mode={service.automationConfig?.mode ?? 'DISABLED'}
          version={service.automationConfig?.activeVersion?.versionNumber ?? null}
        />
      )}
    </div>
  );
}
