import type { ReactNode } from 'react';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { SERVICE_OBJECTIVE_CONTRACT } from '@/lib/slo/contract';
import { requirePageAccess } from '@/lib/access/server';
import { AlertTriangle, CheckCircle2, Target, XCircle } from 'lucide-react';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import {
  ServiceObjectiveCreate,
  ServiceObjectivesDirectory,
  type ServiceObjectiveItem,
} from '@/components/settings/ServiceObjectivesDirectory';
import { summarizeObjective } from '@/components/settings/serviceObjectiveSummary';
import ObjectiveBudgetForecast from '@/components/settings/ObjectiveBudgetForecast';
import { getObjectiveForecasts } from '@/lib/slo/forecast-loader';

export const revalidate = 0;
export default async function ServiceObjectivesPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  await requirePageAccess('/settings/service-objectives');
  const actor = await getCurrentAuthorizationActor();
  const query = z
    .object({
      after: z
        .string()
        .regex(/^[a-z0-9_-]{1,100}$/i)
        .optional(),
    })
    .parse(await searchParams);
  const canReadHistory = hasCapability(actor.role, CAPABILITIES.METRICS_READ_ALL);
  const rows = await prisma.serviceObjective.findMany({
    where: {
      ...serviceObjectiveReadWhere(actor),
      activeTo: null,
      ...(query.after ? { id: { gt: query.after } } : {}),
    },
    include: {
      service: { select: { name: true } },
      // Latest scheduled snapshot; shared history needs global metric visibility (as in the API).
      snapshots: {
        orderBy: { periodEnd: 'desc' },
        take: canReadHistory ? 1 : 0,
        select: { value: true, breached: true, dataState: true, periodEnd: true },
      },
    },
    orderBy: { id: 'asc' },
    take: 26,
  });
  const admin = hasCapability(actor.role, CAPABILITIES.ADMIN_MANAGE);
  const forecasts = await getObjectiveForecasts(actor, rows.slice(0, 25));
  const items: ServiceObjectiveItem[] = rows.slice(0, 25).map(row => {
    const forecast = forecasts.get(row.id);
    return {
    id: row.id,
    lineageId: row.lineageId,
    version: row.version,
    name: row.name,
    description: row.description,
    serviceName: row.service?.name ?? null,
    metricType: row.metricType,
    target: row.target,
    comparator: row.comparator,
    windowType: row.windowType,
    windowValue: row.windowValue,
    ...summarizeObjective({
      metricType: row.metricType,
      target: row.target,
      comparator: row.comparator,
      snapshot: row.snapshots?.[0] ?? null,
      canReadHistory,
    }),
      forecast: forecast ? <ObjectiveBudgetForecast forecast={forecast} /> : undefined,
    };
  });
  const total = rows.length > 25 ? '25+' : String(rows.length);
  const count = (health: ServiceObjectiveItem['health']) =>
    items.filter(item => item.health === health).length;
  const healthStat = (
    label: string,
    health: ServiceObjectiveItem['health'],
    icon: ReactNode,
    activeClass: string
  ) => {
    const value = count(health);
    return {
      label,
      value: canReadHistory ? value : '—',
      icon,
      valueClassName: canReadHistory && value > 0 ? activeClass : undefined,
      subtext: canReadHistory
        ? rows.length > 25
          ? 'Of the first 25'
          : 'Latest snapshot'
        : 'Needs global metrics',
    };
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Service objectives"
        icon={Target}
        description="Versioned uptime and response-time targets for services, kept separate from incident response policies."
        statsPlacement="bottom"
        stats={[
          {
            label: 'Active objectives',
            value: total,
            icon: <Target className="h-4 w-4" aria-hidden="true" />,
          },
          healthStat(
            'Meeting target',
            'MEETING',
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
            'text-emerald-300'
          ),
          healthStat(
            'At risk',
            'AT_RISK',
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
            'text-amber-300'
          ),
          healthStat(
            'Breached',
            'BREACHED',
            <XCircle className="h-4 w-4" aria-hidden="true" />,
            'text-rose-300'
          ),
        ]}
      />

      {admin && <ServiceObjectiveCreate />}

      <ServiceObjectivesDirectory
        items={items}
        admin={admin}
        total={total}
        nextHref={
          rows.length > 25
            ? `/settings/service-objectives?after=${encodeURIComponent(rows[24].id)}`
            : null
        }
      />

      <section
        aria-labelledby="objective-measurement-heading"
        className="space-y-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm [&_p]:text-xs [&_p]:text-muted-foreground"
      >
        <h2 id="objective-measurement-heading" className="text-sm font-semibold text-foreground">
          How objectives are measured
        </h2>
        <p>{SERVICE_OBJECTIVE_CONTRACT.windowSemantics}</p>
        <p>
          Availability measures uptime, rather than request success. MTTA and MTTR targets use
          minutes.
        </p>
        <p>{SERVICE_OBJECTIVE_CONTRACT.noData}</p>
      </section>
    </div>
  );
}
