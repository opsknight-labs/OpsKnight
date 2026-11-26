import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, Download } from 'lucide-react';
import ImpactBars, { hours } from '@/components/analytics/ImpactBars';
import BusinessImpactFilters from '@/components/analytics/BusinessImpactFilters';
import { KPI_CARD, KPI_GRID, KpiBody } from '@/components/analytics/KpiCard';
import { SectionCard } from '@/components/analytics/SectionCard';
import { formatDuration } from '@/components/analytics/format';
import { EmptyState, PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { requirePageAccess } from '@/lib/access/server';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { teamReadWhere } from '@/lib/authorization-filters';
import {
  IMPACT_REPORT_LIMIT,
  getBusinessImpactReport,
  impactReportSearch,
  parseImpactReportParams,
} from '@/lib/business-services/impact-report';
import { formatMoney } from '@/lib/business-services/impact-cost';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Business impact' };
export const dynamic = 'force-dynamic';

const TIER_LABEL = { TIER_0: 'Tier 0', TIER_1: 'Tier 1', TIER_2: 'Tier 2', TIER_3: 'Tier 3' };
const head = 'h-9 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const num = 'px-3 py-2 text-right tabular-nums';

const uptime = (value: number) =>
  value >= 100 ? '100%' : `${(Math.floor(value * 100) / 100).toFixed(2)}%`;
const minutes = (value: number | null) => (value === null ? '—' : formatDuration(value * 60_000));

/**
 * Business impact report: per business service uptime, incidents, MTTA/MTTR, impacted time and the
 * member that hurt most, from the business-service engine (union of impact intervals).
 */
export default async function BusinessImpactPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageAccess('/insights/business-impact');
  const [actor, raw] = await Promise.all([getCurrentAuthorizationActor(), searchParams]);
  const params = parseImpactReportParams(raw);
  const [report, teams] = await Promise.all([
    getBusinessImpactReport(actor, params),
    prisma.team.findMany({
      where: teamReadWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
  ]);
  const canExport = hasCapability(actor.role, CAPABILITIES.REPORT_EXPORT);
  const search = impactReportSearch(params);
  const rows = report.rows;
  const impacted = rows.filter(row => row.stats.impactMinutes > 0);
  const totalImpact = rows.reduce((sum, row) => sum + row.stats.impactMinutes, 0);
  const average = rows.length
    ? rows.reduce((sum, row) => sum + row.stats.uptimePercent, 0) / rows.length
    : null;
  const worst = rows.length
    ? rows.reduce((low, row) => (row.stats.uptimePercent < low.stats.uptimePercent ? row : low))
    : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        eyebrow="Reliability insights"
        title="Business impact"
        description="How incidents affected each business service: uptime, response times and impacted hours."
        icon={Boxes}
        breadcrumbs={[{ label: 'Analytics', href: '/insights' }, { label: 'Business impact' }]}
        primaryAction={
          canExport ? (
            <a
              href={`/api/insights/business-impact/export${search ? `?${search}` : ''}`}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                pageHeaderActionClass
              )}
            >
              <Download className="h-4 w-4" aria-hidden />
              Export CSV
            </a>
          ) : undefined
        }
      />
      <BusinessImpactFilters params={params} teams={teams} />
      {report.truncated && (
        <InlineNotice tone="info">
          Showing the first {IMPACT_REPORT_LIMIT} business services. Filter by team or tier to see
          the rest.
        </InlineNotice>
      )}
      {rows.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Boxes className="h-6 w-6" aria-hidden="true" />}
          title="No business services in this view"
          description="Business services you can access appear here. Clear the team or tier filter, or create one."
          primaryAction={
            <Link className="underline" href="/services/business">
              Business services
            </Link>
          }
        />
      ) : (
        <>
          <div className={KPI_GRID}>
            <div className={KPI_CARD}>
              <KpiBody
                label="Impacted services"
                value={`${impacted.length} of ${rows.length}`}
                meta={`Last ${params.days} days`}
              />
            </div>
            <div className={KPI_CARD}>
              <KpiBody
                label="Impacted hours"
                value={hours(totalImpact)}
                empty={totalImpact === 0}
                meta="Summed across services"
              />
            </div>
            <div className={KPI_CARD}>
              <KpiBody
                label="Average uptime"
                value={average === null ? '—' : uptime(average)}
                empty={average === null}
              />
            </div>
            <div className={KPI_CARD}>
              <KpiBody
                label="Lowest uptime"
                value={worst ? uptime(worst.stats.uptimePercent) : '—'}
                empty={!worst}
                meta={worst ? <span className="truncate">{worst.name}</span> : undefined}
              />
            </div>
          </div>
          <SectionCard
            id="impact-bars"
            title="Impacted hours"
            description="The ten most affected business services in this period"
          >
            <ImpactBars rows={rows} />
          </SectionCard>
          <SectionCard
            id="impact-table"
            title="Business services"
            description="Uptime counts overlapping incidents once. Worst member is the member service whose own incidents impacted the service longest."
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr>
                    <th scope="col" className={head}>
                      Business service
                    </th>
                    <th scope="col" className={cn(head, 'hidden md:table-cell')}>
                      Owner
                    </th>
                    <th scope="col" className={cn(head, 'text-right')}>
                      Uptime
                    </th>
                    <th scope="col" className={cn(head, 'text-right')}>
                      Incidents
                    </th>
                    <th scope="col" className={cn(head, 'hidden text-right sm:table-cell')}>
                      MTTA
                    </th>
                    <th scope="col" className={cn(head, 'hidden text-right sm:table-cell')}>
                      MTTR
                    </th>
                    <th scope="col" className={cn(head, 'text-right')}>
                      Impacted
                    </th>
                    <th scope="col" className={cn(head, 'hidden text-right md:table-cell')}>
                      Est. cost
                    </th>
                    <th scope="col" className={cn(head, 'hidden lg:table-cell')}>
                      Worst member
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="max-w-[16rem] px-3 py-2">
                        <Link
                          href={`/services/business/${row.id}`}
                          className="block truncate font-medium text-foreground hover:underline"
                        >
                          {row.name}
                        </Link>
                        {row.criticality && (
                          <span className="text-xs text-muted-foreground">
                            {TIER_LABEL[row.criticality]}
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                        {row.ownerTeam?.name ?? '—'}
                      </td>
                      <td
                        className={cn(
                          num,
                          'font-semibold',
                          row.stats.uptimePercent < 99 && 'text-destructive'
                        )}
                      >
                        {uptime(row.stats.uptimePercent)}
                      </td>
                      <td className={num}>{row.stats.incidentCount}</td>
                      <td className={cn(num, 'hidden sm:table-cell')}>
                        {minutes(row.stats.mttaMinutes)}
                      </td>
                      <td className={cn(num, 'hidden sm:table-cell')}>
                        {minutes(row.stats.mttrMinutes)}
                      </td>
                      <td className={num}>{hours(row.stats.impactMinutes)}</td>
                      <td className={cn(num, 'hidden md:table-cell')}>
                        {row.estimatedCostCents === null
                          ? '—'
                          : formatMoney(row.estimatedCostCents, row.currency)}
                        {row.customersTotal !== null && (
                          <span className="block text-xs text-muted-foreground">
                            {row.customersTotal.toLocaleString('en-US')} customers
                          </span>
                        )}
                      </td>
                      <td className="hidden max-w-[14rem] px-3 py-2 lg:table-cell">
                        {row.worstMember ? (
                          <Link
                            href={`/services/${row.worstMember.id}`}
                            className="block truncate hover:underline"
                          >
                            {row.worstMember.name}
                            <span className="text-xs text-muted-foreground">
                              {' '}
                              · {hours(row.worstMember.impactMinutes)}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
