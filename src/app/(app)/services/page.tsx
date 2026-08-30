import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import { getUserPermissions, assertAdminOrResponder } from '@/lib/rbac';
import { assertServiceNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import ServicesListTable from '@/components/service/ServicesListTable';
import ServicesFilters from '@/components/service/ServicesFilters';
import CreateServiceForm from '@/components/service/CreateServiceForm';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Server, AlertTriangle, XCircle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { activeIncidentStatuses } from '@/lib/incident-status';

export const revalidate = 0;

async function createService(formData: FormData) {
  'use server';
  let currentUser: { id: string };
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }
  const rawName = formData.get('name');
  const description = formData.get('description') as string;
  const region = formData.get('region') as string;
  const slaTier = formData.get('slaTier') as string;
  const teamId = formData.get('teamId') as string;
  const escalationPolicyId = formData.get('escalationPolicyId') as string;
  const name = typeof rawName === 'string' ? rawName : '';

  try {
    const normalizedName = await assertServiceNameAvailable(name);

    const service = await prisma.service.create({
      data: {
        name: normalizedName,
        description,
        region: region || null,
        slaTier: slaTier || null,
        teamId: teamId || undefined,
        escalationPolicyId: escalationPolicyId || undefined,
      },
    });

    await logAudit({
      action: 'service.created',
      entityType: 'SERVICE',
      entityId: service.id,
      actorId: currentUser.id,
      details: { name: normalizedName, teamId: teamId || null },
    });

    revalidatePath('/services');
    revalidatePath('/audit');
    redirect('/services');
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect('/services?error=duplicate-service');
    }

    throw error;
  }
}

const ITEMS_PER_PAGE = 20;

type ServicesPageProps = {
  searchParams: Promise<{
    search?: string;
    status?: string;
    team?: string;
    sort?: string;
    error?: string;
    page?: string;
  }>;
};

export default async function ServicesPage({ searchParams }: ServicesPageProps) {
  const params = await searchParams;
  const searchQuery = typeof params?.search === 'string' ? params.search.trim() : '';
  const statusFilter = typeof params?.status === 'string' ? params.status : 'all';
  const teamFilter = typeof params?.team === 'string' ? params.team : '';
  const sortBy = typeof params?.sort === 'string' ? params.sort : 'name_asc';
  const errorCode = typeof params?.error === 'string' ? params.error : '';
  const currentPage = Math.max(
    1,
    parseInt(typeof params?.page === 'string' ? params.page : '1', 10)
  );

  const [teams, policies] = await Promise.all([
    prisma.team.findMany({ orderBy: { name: 'asc' } }),
    prisma.escalationPolicy.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Build where clause for filtering
  const andConditions: Prisma.ServiceWhereInput[] = [];
  if (searchQuery) {
    andConditions.push({
      OR: [
        { name: { contains: searchQuery, mode: 'insensitive' as const } },
        { description: { contains: searchQuery, mode: 'insensitive' as const } },
      ],
    });
  }
  if (teamFilter) andConditions.push({ teamId: teamFilter });
  if (statusFilter !== 'all') {
    const active = {
      status: { in: activeIncidentStatuses() },
    };
    if (statusFilter === 'CRITICAL') {
      andConditions.push({ incidents: { some: { ...active, urgency: 'HIGH' } } });
    } else if (statusFilter === 'DEGRADED') {
      andConditions.push({
        AND: [
          { incidents: { some: active } },
          { incidents: { none: { ...active, urgency: 'HIGH' } } },
        ],
      });
    } else if (statusFilter === 'OPERATIONAL') {
      andConditions.push({ incidents: { none: active } });
    }
  }
  const where: Prisma.ServiceWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

  // Build orderBy clause
  let orderBy: Prisma.ServiceOrderByWithRelationInput = { name: 'asc' };
  if (sortBy === 'name_desc') {
    orderBy = { name: 'desc' };
  } else if (sortBy === 'status') {
    orderBy = { status: 'asc' };
  } else if (sortBy === 'incidents_desc') {
    orderBy = { incidents: { _count: 'desc' } };
  } else if (sortBy === 'incidents_asc') {
    orderBy = { incidents: { _count: 'asc' } };
  }

  const totalFilteredItems = await prisma.service.count({ where });
  const totalPages = Math.ceil(totalFilteredItems / ITEMS_PER_PAGE);
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;

  const services = await prisma.service.findMany({
    where,
    skip: startIdx,
    take: ITEMS_PER_PAGE,
    select: {
      id: true,
      name: true,
      description: true,
      region: true,
      slaTier: true,
      status: true,
      team: true,
      policy: {
        select: { id: true, name: true },
      },
    },
    orderBy,
  });

  const { calculateSLAMetrics } = await import('@/lib/sla-server');
  const slaWindowDays = 30;
  // SLA server is the source of truth for service metrics/status
  const slaMetrics = await calculateSLAMetrics({
    windowDays: slaWindowDays,
    includeActiveIncidents: true,
    serviceId: services.map(s => s.id),
  }).catch(err => {
    console.error('Failed to load SLA metrics for services:', err);
    return null;
  });
  const slaServiceMap = new Map((slaMetrics?.serviceMetrics || []).map(s => [s.id, s]));
  const metricDataState = slaMetrics ? ('available' as const) : ('unavailable' as const);

  const paginatedServices = services.map(service => {
    const slaData = slaServiceMap.get(service.id);
    const dynamicStatus = (slaData?.dynamicStatus || service.status || 'OPERATIONAL') as
      | 'OPERATIONAL'
      | 'DEGRADED'
      | 'CRITICAL';
    const openIncidentCount = slaData?.activeCount ?? 0;
    const hasCritical = (slaData?.criticalCount ?? 0) > 0;
    const incidentCount = slaData?.count ?? 0;

    return {
      ...service,
      dynamicStatus,
      openIncidentCount,
      hasCritical,
      incidentCount,
      metricDataState,
    };
  });

  // Calculate high-level stats (just for the page, or maybe we need total stats?)
  // If we need total stats, we can't get it without fetching all. Let's just keep stats based on what we have, or leave it. Wait, the user didn't mention stats, but they said "Remove the in-memory .filter(), .sort(), .slice() operations".
  const totalServices = totalFilteredItems;
  const active = {
    status: { in: activeIncidentStatuses() },
  };
  const [operationalCount, degradedCount, criticalCount] = await Promise.all([
    prisma.service.count({ where: { incidents: { none: active } } }),
    prisma.service.count({
      where: {
        AND: [
          { incidents: { some: active } },
          { incidents: { none: { ...active, urgency: 'HIGH' } } },
        ],
      },
    }),
    prisma.service.count({
      where: { incidents: { some: { ...active, urgency: 'HIGH' } } },
    }),
  ]);

  const permissions = await getUserPermissions();
  const canCreateService = permissions.isAdminOrResponder;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Hero Banner */}
      <DetailHeroBanner
        tag="Infrastructure Directory"
        title="Services"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Server className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Monitor real-time service health, SLA compliance, and incident response routing.
          </p>
        }
        stats={[
          {
            label: 'Total Services',
            value: totalServices,
            icon: <Server className="h-3.5 w-3.5" />,
          },
          {
            label: 'Operational',
            value: operationalCount,
            icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: 'text-emerald-200',
          },
          {
            label: 'Degraded',
            value: degradedCount,
            icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: degradedCount > 0 ? 'text-amber-200' : undefined,
          },
          {
            label: 'Critical',
            value: criticalCount,
            icon: <XCircle className="h-3.5 w-3.5 text-rose-200" />,
            valueClassName: criticalCount > 0 ? 'text-rose-200' : undefined,
          },
        ]}
      />

      <div className="space-y-4 md:space-y-5">
        {/* Error Alert */}
        {errorCode === 'duplicate-service' && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              A service with this name already exists. Please choose a unique name.
            </AlertDescription>
          </Alert>
        )}

        {/* Create Service */}
        {canCreateService ? (
          <CreateServiceForm teams={teams} policies={policies} createAction={createService} />
        ) : (
          <Alert className="bg-muted/50">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Access Restricted</AlertTitle>
            <AlertDescription>
              You do not have access to create services. Admin or Responder role required.
            </AlertDescription>
          </Alert>
        )}

        {/* Filters */}
        <ServicesFilters
          currentSearch={searchQuery}
          currentStatus={statusFilter}
          currentTeam={teamFilter}
          currentSort={sortBy}
          teams={teams}
        />

        {/* Services List Table */}
        <ServicesListTable
          services={paginatedServices}
          canManageServices={canCreateService}
          pagination={{
            currentPage,
            totalPages,
            totalItems: totalFilteredItems,
            itemsPerPage: ITEMS_PER_PAGE,
          }}
        />

        <Card className="bg-muted/40 border-dashed">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Service health reflects real-time monitoring and incident activity. Active counts
            exclude snoozed and suppressed incidents.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
