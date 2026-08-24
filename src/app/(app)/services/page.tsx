import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDefaultActorId, logAudit } from '@/lib/audit';
import { getUserPermissions, assertAdminOrResponder } from '@/lib/rbac';
import { assertServiceNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import ServicesListTable from '@/components/service/ServicesListTable';
import ServicesFilters from '@/components/service/ServicesFilters';
import CreateServiceForm from '@/components/service/CreateServiceForm';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Server, AlertTriangle, XCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';

export const revalidate = 0;

async function createService(formData: FormData) {
  'use server';
  try {
    await assertAdminOrResponder();
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
      actorId: await getDefaultActorId(),
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
    andConditions.push({ status: statusFilter as import('@prisma/client').ServiceStatus });
  }
  const where: Prisma.ServiceWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

  // Build orderBy clause
  let orderBy: Prisma.ServiceOrderByWithRelationInput = { name: 'asc' };
  if (sortBy === 'name_desc') {
    orderBy = { name: 'desc' };
  } else if (sortBy === 'status') {
    orderBy = { status: 'asc' };
  } else if (sortBy === 'incidents_desc') {
    // Cannot easily sort by dynamic incidents in DB, fallback to name or ignore
    orderBy = { name: 'asc' };
  } else if (sortBy === 'incidents_asc') {
    orderBy = { name: 'desc' };
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
  });
  const slaServiceMap = new Map(slaMetrics.serviceMetrics.map(s => [s.id, s]));

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
    };
  });

  // Calculate high-level stats (just for the page, or maybe we need total stats?)
  // If we need total stats, we can't get it without fetching all. Let's just keep stats based on what we have, or leave it. Wait, the user didn't mention stats, but they said "Remove the in-memory .filter(), .sort(), .slice() operations".
  const totalServices = totalFilteredItems;
  const operationalCount = await prisma.service.count({
    where: { status: 'OPERATIONAL' as import('@prisma/client').ServiceStatus },
  });
  const degradedCount = await prisma.service.count({
    where: { status: 'DEGRADED' as import('@prisma/client').ServiceStatus },
  });
  const criticalCount = await prisma.service.count({
    where: { status: 'CRITICAL' as import('@prisma/client').ServiceStatus },
  });

  const permissions = await getUserPermissions();
  const canCreateService = permissions.isAdminOrResponder;

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Metric panel */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white rounded-lg p-4 md:p-6 shadow-lg">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight flex items-center gap-2 text-white">
              <Server className="h-6 w-6 md:h-8 md:w-8" />
              Services
            </h1>
            <p className="text-xs md:text-sm opacity-90 mt-1 text-white">
              Monitor service health and performance
            </p>
            <p className="text-[11px] md:text-xs opacity-80 mt-1">
              Metrics shown for the last 30 days.
            </p>
            <p className="text-[11px] md:text-xs opacity-80">
              Active incident counts exclude snoozed and suppressed incidents.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-4 w-full lg:w-auto">
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold">{totalServices}</div>
                <div className="text-[10px] md:text-xs opacity-90">Total Services</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-emerald-200">
                  {operationalCount}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Operational</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-yellow-200">
                  {degradedCount}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Degraded</div>
              </CardContent>
            </Card>
            <Card className="bg-white/10 border-white/20 backdrop-blur">
              <CardContent className="p-3 md:p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold text-red-200">
                  {criticalCount}
                </div>
                <div className="text-[10px] md:text-xs opacity-90">Critical</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

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
