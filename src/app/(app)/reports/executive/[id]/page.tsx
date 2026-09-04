import { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import { serializeSlaMetrics } from '@/lib/sla';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { DASHBOARD_TEMPLATES } from '@/lib/reports/dashboard-templates';
import DashboardViewer from '../DashboardViewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard | OpsKnight',
  description: 'Custom dashboard view',
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ window?: string; teamId?: string; serviceId?: string }>;
};

export default async function SavedDashboardPage({ params, searchParams }: PageProps) {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/reports');
  }

  const { id } = await params;
  const queryParams = await searchParams;

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, timeZone: true },
  });

  if (!user) {
    redirect('/login?callbackUrl=/reports');
  }

  // Fetch the dashboard
  const dashboard = await prisma.dashboard.findUnique({
    where: { id },
    include: { widgets: { orderBy: { createdAt: 'asc' } } },
  });

  if (!dashboard) {
    notFound();
  }

  // Check access
  if (dashboard.userId !== user.id && dashboard.visibility === 'PRIVATE') {
    notFound();
  }

  const userTimeZone = getUserTimeZone(user);
  const actor = await getCurrentAuthorizationActor();

  // Parse filters
  const windowDays = Number(queryParams?.window || 7);
  const teamId = queryParams?.teamId || undefined;
  const serviceId = queryParams?.serviceId || undefined;

  // Fetch metrics
  const metrics = await calculateActorSLAMetrics(actor, {
    windowDays,
    teamId,
    serviceId,
    userTimeZone,
  });

  const serializedMetrics = serializeSlaMetrics(metrics);
  const lastUpdatedLabel = formatDateTime(new Date(), userTimeZone, { format: 'datetime' });

  // Fetch filter options
  const [teams, services] = await Promise.all([
    prisma.team.findMany({
      where: teamReadWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.service.findMany({
      where: serviceReadWhere(actor),
      select: { id: true, name: true, teamId: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Transform widgets to expected format
  const widgets = dashboard.widgets.map(w => ({
    id: w.id,
    widgetType: w.widgetType,
    metricKey: w.metricKey,
    title: w.title,
    position: w.position as { x: number; y: number; w: number; h: number },
    config: w.config as Record<string, any>,
  }));

  return (
    <DashboardViewer
      dashboardName={dashboard.name}
      dashboardDescription={dashboard.description || ''}
      widgets={widgets}
      metrics={serializedMetrics}
      lastUpdated={lastUpdatedLabel}
      currentFilters={{
        windowDays,
        teamId,
        serviceId,
      }}
      filterOptions={{
        teams,
        services: teamId ? services.filter(s => s.teamId === teamId) : services,
      }}
      templates={DASHBOARD_TEMPLATES}
      isTemplate={false}
      dashboardId={dashboard.id}
    />
  );
}
