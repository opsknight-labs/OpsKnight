import Link from 'next/link';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { SERVICE_OBJECTIVE_CONTRACT } from '@/lib/slo/contract';
import { ServiceObjectiveForm } from '@/components/settings/ServiceObjectiveForm';
import { requirePageAccess } from '@/lib/access/server';
import { ChevronDown, Target } from 'lucide-react';
import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';

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
  const disclosureClass =
    'group rounded-md border border-border bg-background [&_summary::-webkit-details-marker]:hidden';
  const summaryClass =
    'flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const chevron = (
    <ChevronDown
      className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
      aria-hidden="true"
    />
  );

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Service objectives"
        icon={Target}
        description="Versioned uptime and response-time targets for services, kept separate from incident response policies."
        stats={[
          {
            label: 'Active objectives',
            value: rows.length > 25 ? '25+' : rows.length,
            icon: <Target className="h-3.5 w-3.5" aria-hidden="true" />,
          },
        ]}
      />

      <SettingsSection
        title="How objectives are measured"
        description="What each target means before you set one."
        contentClassName="space-y-2 py-4 text-sm text-muted-foreground"
      >
        <p>{SERVICE_OBJECTIVE_CONTRACT.windowSemantics}</p>
        <p>
          Availability measures uptime, rather than request success. MTTA and MTTR targets use
          minutes.
        </p>
        <p>{SERVICE_OBJECTIVE_CONTRACT.noData}</p>
      </SettingsSection>

      {admin && (
        <SettingsSection
          title="Create objective"
          description="Add a target for a service. Saving creates version 1; later edits create new versions."
          contentClassName="py-4"
        >
          <ServiceObjectiveForm />
        </SettingsSection>
      )}

      <section aria-labelledby="active-objectives-heading" className="space-y-3">
        <h2 id="active-objectives-heading" className="px-1 text-base font-semibold text-foreground">
          Active objectives
        </h2>
        {!rows.length && (
          <EmptyState
            icon={<Target />}
            title="No active objectives in your accessible services."
            description={
              admin
                ? 'Create an objective above to start tracking a target.'
                : 'Objectives appear here once an administrator defines them for your services.'
            }
          />
        )}
        <ul className="space-y-3">
          {rows.slice(0, 25).map(row => (
            <li
              key={row.id}
              className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm md:px-6"
            >
              <article className="space-y-3" aria-labelledby={`objective-${row.id}`}>
                <div className="space-y-1">
                  <h3
                    id={`objective-${row.id}`}
                    className="text-base font-semibold text-foreground"
                  >
                    {row.name}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {row.service?.name ?? 'Workspace'} · {row.metricType} ·{' '}
                    <span className="tabular-nums">Version {row.version}</span>
                  </p>
                </div>
                <p className="text-sm tabular-nums text-foreground">
                  {row.comparator === 'GREATER_THAN_OR_EQUAL' ? 'At least' : 'At most'} {row.target}{' '}
                  {['UPTIME', 'AVAILABILITY'].includes(row.metricType)
                    ? '%'
                    : ['MTTA', 'MTTR'].includes(row.metricType)
                      ? 'minutes'
                      : '(legacy target; evaluation unavailable)'}{' '}
                  · {row.windowType.replaceAll('_', ' ')}
                </p>
                {row.description && (
                  <p className="text-sm text-muted-foreground">{row.description}</p>
                )}
                {admin && (
                  <div className="space-y-2">
                    {SERVICE_OBJECTIVE_CONTRACT.metrics.some(
                      metric => metric.id === row.metricType
                    ) && (
                      <details className={disclosureClass}>
                        <summary className={summaryClass}>
                          Edit objective
                          {chevron}
                        </summary>
                        <div className="border-t border-border p-3">
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
                        </div>
                      </details>
                    )}
                    <details className={disclosureClass}>
                      <summary className={summaryClass}>
                        Archive objective
                        {chevron}
                      </summary>
                      <div className="space-y-3 border-t border-border p-3">
                        <p className="text-sm text-muted-foreground">
                          Retires the active definition. Existing versions and measurements remain
                          available through the API.
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
                      </div>
                    </details>
                  </div>
                )}
              </article>
            </li>
          ))}
        </ul>
        {rows.length > 25 && (
          <nav aria-label="Objective pages" className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href={`/settings/service-objectives?after=${encodeURIComponent(rows[24].id)}`}>
                Next objectives
              </Link>
            </Button>
          </nav>
        )}
      </section>
    </div>
  );
}
