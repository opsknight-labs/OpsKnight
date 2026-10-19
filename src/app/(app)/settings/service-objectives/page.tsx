import Link from 'next/link';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { SERVICE_OBJECTIVE_CONTRACT } from '@/lib/slo/contract';
import { ServiceObjectiveForm } from '@/components/settings/ServiceObjectiveForm';

export const revalidate = 0;
export default async function ServiceObjectivesPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  const actor = await getCurrentAuthorizationActor();
  const query = z
    .object({
      after: z
        .string()
        .regex(/^[a-z0-9_-]{1,100}$/i)
        .optional(),
    })
    .parse(await searchParams);
  const rows = await prisma.serviceObjective.findMany({
    where: {
      ...serviceObjectiveReadWhere(actor),
      activeTo: null,
      ...(query.after ? { id: { gt: query.after } } : {}),
    },
    include: { service: { select: { name: true } } },
    orderBy: { id: 'asc' },
    take: 26,
  });
  const admin = hasCapability(actor.role, CAPABILITIES.ADMIN_MANAGE);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Service objectives</h1>
        <p>Manage versioned service targets separately from incident response policies.</p>
      </header>
      <div className="space-y-2 rounded-lg border border-border p-4">
        <p>{SERVICE_OBJECTIVE_CONTRACT.windowSemantics}</p>
        <p>
          Availability measures uptime, rather than request success. MTTA and MTTR targets use
          minutes.
        </p>
        <p>{SERVICE_OBJECTIVE_CONTRACT.noData}</p>
      </div>
      {admin && (
        <details className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer font-medium">Create objective</summary>
          <ServiceObjectiveForm />
        </details>
      )}
      {!rows.length && <p>No active objectives in your accessible services.</p>}
      {rows.slice(0, 25).map(row => (
        <article key={row.id} className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-lg font-medium">{row.name}</h2>
          <p>
            {row.service?.name ?? 'Workspace'} · {row.metricType} · Version {row.version}
          </p>
          <p>
            {row.comparator === 'GREATER_THAN_OR_EQUAL' ? 'At least' : 'At most'} {row.target}{' '}
            {['UPTIME', 'AVAILABILITY'].includes(row.metricType)
              ? '%'
              : ['MTTA', 'MTTR'].includes(row.metricType)
                ? 'minutes'
                : '(legacy target; evaluation unavailable)'}{' '}
            · {row.windowType.replaceAll('_', ' ')}
          </p>
          {row.description && <p>{row.description}</p>}
          {admin && (
            <>
              {SERVICE_OBJECTIVE_CONTRACT.metrics.some(metric => metric.id === row.metricType) && (
                <details>
                  <summary className="cursor-pointer">Edit objective</summary>
                  <ServiceObjectiveForm
                    objective={{
                      id: row.lineageId,
                      version: row.version,
                      name: row.name,
                      description: row.description,
                      target: row.target,
                      comparator: row.comparator,
                      windowType: row.windowType,
                      windowValue: row.windowValue,
                    }}
                  />
                </details>
              )}
              <details>
                <summary className="cursor-pointer">Archive objective</summary>
                <p>
                  Retires the active definition. Existing versions and measurements remain available
                  through the API.
                </p>
                <ServiceObjectiveForm
                  archive
                  objective={{
                    id: row.lineageId,
                    version: row.version,
                    name: row.name,
                    description: row.description,
                    target: row.target,
                    comparator: row.comparator,
                    windowType: row.windowType,
                    windowValue: row.windowValue,
                  }}
                />
              </details>
            </>
          )}
        </article>
      ))}
      {rows.length > 25 && (
        <Link href={`/settings/service-objectives?after=${encodeURIComponent(rows[24].id)}`}>
          Next objectives
        </Link>
      )}
    </div>
  );
}
