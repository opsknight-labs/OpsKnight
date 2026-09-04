import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import { serializeSlaMetrics } from '@/lib/sla';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { getTemplateById, DASHBOARD_TEMPLATES } from '@/lib/reports/dashboard-templates';
import DashboardViewer from './DashboardViewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Executive Dashboard | OpsKnight',
  description: 'Customizable executive report dashboard',
};

type SearchParams = {
  template?: string;
  window?: string;
  teamId?: string;
  serviceId?: string;
};

export default async function ExecutiveDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/reports/executive');
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, timeZone: true, role: true },
  });

  if (!user) {
    redirect('/login?callbackUrl=/reports/executive');
  }

  const userTimeZone = getUserTimeZone(user);
  const actor = await getCurrentAuthorizationActor();
  const params = await searchParams;

  // Parse filters
  const windowDays = Number(params?.window || 7);
  const teamId = params?.teamId || undefined;
  const serviceId = params?.serviceId || undefined;
  const templateId = params?.template;

  // If template specified, use template widgets
  let widgets: any[] = [];
  let dashboardName = 'Executive Dashboard';
  let dashboardDescription = 'Operational health overview';

  if (templateId) {
    const template = getTemplateById(templateId);
    if (template) {
      widgets = template.widgets.map((w, idx) => ({
        id: `template-${idx}`,
        widgetType: w.widgetType,
        metricKey: w.metricKey,
        title: w.title || null,
        position: w.position,
        config: w.config,
      }));
      dashboardName = template.name;
      dashboardDescription = template.description;
    }
  } else {
    // Default: use executive summary template
    const defaultTemplate = DASHBOARD_TEMPLATES[0];
    widgets = defaultTemplate.widgets.map((w, idx) => ({
      id: `default-${idx}`,
      widgetType: w.widgetType,
      metricKey: w.metricKey,
      title: w.title || null,
      position: w.position,
      config: w.config,
    }));
  }

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

  return (
    <DashboardViewer
      dashboardName={dashboardName}
      dashboardDescription={dashboardDescription}
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
      currentTemplateId={templateId}
      isTemplate={!!templateId}
    />
  );
}
