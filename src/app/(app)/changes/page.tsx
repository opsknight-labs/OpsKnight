import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, CircleDot, GitCommitHorizontal, Info, Minus, Workflow } from 'lucide-react';
import ChangeMappingSection from '@/components/intelligence/lists/ChangeMappingSection';
import ChangesTable from '@/components/intelligence/lists/ChangesTable';
import ListFilterBar from '@/components/intelligence/lists/ListFilterBar';
import { ListPagination } from '@/components/intelligence/lists/shared';
import { NO_VALUE, SectionError } from '@/components/intelligence/overview/primitives';
import { EmptyState, PageHeader } from '@/components/patterns';
import type { FilterChipTone } from '@/components/patterns/FilterBar';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { Button } from '@/components/ui/shadcn/button';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { countChangesForActor, listChangesForActor } from '@/lib/intelligence/lists/changes';
import {
  CHANGE_RISK_OPTIONS,
  DEFAULT_LIST_WINDOW,
  LIST_WINDOWS,
  changeRiskBand,
  listQueryString,
  parseChangeListFilters,
  type ChangeRiskBand,
  type ListParam,
} from '@/lib/intelligence/lists/contract';
import { loadSection } from '@/lib/intelligence/overview';
import { formatCount, overviewWindowSpec } from '@/lib/intelligence/overview/window';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { getUserTimeZone } from '@/lib/timezone';
import { requirePageAccess } from '@/lib/access/server';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = { title: 'Changes' };

const RISK_CHIPS: Record<ChangeRiskBand, { tone?: FilterChipTone; icon: ReactNode }> = {
  high: { tone: 'critical', icon: <AlertTriangle /> },
  medium: { tone: 'elevated', icon: <CircleDot /> },
  low: { icon: <Info /> },
  unscored: { icon: <Minus /> },
};

/**
 * Deploys, config changes, feature flags and infrastructure changes the viewer may read, newest first,
 * with each change's risk score and the incidents whose analysis points at it. Read-only.
 */
export default async function ChangesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, ListParam>>;
}) {
  await requirePageAccess('/changes');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const actor = await getCurrentAuthorizationActor();
  const filters = parseChangeListFilters((await searchParams) ?? {});
  const [result, total] = await Promise.all([
    loadSection('changes', () => listChangesForActor(actor, filters)),
    loadSection('change count', () => countChangesForActor(actor, filters)),
  ]);

  const query = {
    q: filters.q,
    service: filters.serviceId,
    source: filters.source,
    risk: filters.risk,
    window: filters.window,
  };
  const filtered = Boolean(filters.serviceId || filters.source || filters.risk || filters.q);
  const services = result.ok ? result.data.services : [];
  const serviceOptions = services.map(service => ({ value: service.id, label: service.name }));
  if (filters.serviceId && !services.some(service => service.id === filters.serviceId))
    serviceOptions.push({ value: filters.serviceId, label: 'Selected service' });
  const sources = result.ok ? [...result.data.sources] : [];
  if (filters.source && !sources.includes(filters.source)) sources.push(filters.source);
  const rows = result.ok ? result.data.rows : [];
  const windowLabel = overviewWindowSpec(filters.window).label;
  const highRisk = rows.filter(row => changeRiskBand(row.riskScore) === 'high').length;
  const linked = rows.filter(row => row.linkedIncidentCount > 0).length;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 sm:space-y-6">
      <PageHeader
        eyebrow="AIOps"
        title="Changes"
        icon={GitCommitHorizontal}
        description="Deploys, config changes, feature flags and infrastructure changes sent to OpsKnight, newest first. Risk is a ranking signal to help you look in the right place, never proof that a change caused an incident."
        primaryAction={
          canManage ? (
            <Button asChild size="sm" className={cn('h-11 sm:h-9', pageHeaderActionClass)}>
              <Link href="/settings/intelligence/services#change-sources">
                <Workflow className="h-4 w-4" aria-hidden="true" />
                Change sources
              </Link>
            </Button>
          ) : undefined
        }
        stats={[
          {
            label: filtered ? 'Matching changes' : 'Changes',
            value: total.ok ? formatCount(total.data) : NO_VALUE,
            subtext: total.ok ? windowLabel : 'Count unavailable',
          },
          { label: 'On this page', value: formatCount(rows.length), subtext: 'Newest first' },
          { label: 'High risk', value: formatCount(highRisk), subtext: 'On this page' },
          { label: 'Linked to incidents', value: formatCount(linked), subtext: 'On this page' },
        ]}
      />

      <ListFilterBar
        basePath="/changes"
        label="Filter changes"
        description="Search, then narrow by risk, service, source or time range."
        defaults={{ window: DEFAULT_LIST_WINDOW }}
        search={{
          value: filters.q ?? '',
          label: 'Search changes',
          placeholder: 'Search summary, source, version or component…',
        }}
        chips={{
          name: 'risk',
          label: 'Risk',
          value: filters.risk ?? '',
          anyLabel: 'Any risk',
          options: CHANGE_RISK_OPTIONS.map(option => ({ ...option, ...RISK_CHIPS[option.value] })),
        }}
        fields={[
          {
            name: 'service',
            label: 'Service',
            value: filters.serviceId ?? '',
            anyLabel: 'All services',
            options: serviceOptions,
          },
          {
            name: 'source',
            label: 'Source',
            value: filters.source ?? '',
            anyLabel: 'Any source',
            options: sources.map(value => ({ value, label: value })),
          },
          {
            name: 'window',
            label: 'Time range',
            value: filters.window,
            options: LIST_WINDOWS.map(spec => ({ value: spec.key, label: spec.label })),
          },
        ]}
      />

      {!result.ok ? (
        <SectionError message={result.error} />
      ) : (
        <ChangesTable
          rows={rows}
          timeZone={getUserTimeZone(user)}
          summary={`${formatCount(rows.length)} on this page${
            total.ok ? ` · ${formatCount(total.data)} matching` : ''
          } · ${windowLabel.toLowerCase()}`}
          notice={
            (result.data.linksTruncated || result.data.servicesTruncated) && (
              <div className="space-y-1 border-b border-border px-4 py-2 text-xs text-muted-foreground">
                {result.data.linksTruncated && (
                  <p>
                    Linked incidents are taken from the 500 most recent incidents in this
                    page&apos;s time span, so some links may be missing.
                  </p>
                )}
                {result.data.servicesTruncated && (
                  <p>The service filter lists the first 200 services by name.</p>
                )}
              </div>
            )
          }
          empty={
            <EmptyState
              variant="simple"
              icon={<GitCommitHorizontal aria-hidden="true" />}
              title={filtered ? 'No changes match these filters' : 'No changes in this time range'}
              description={
                filtered
                  ? 'Try a wider time range, a different search or remove a filter.'
                  : 'Changes appear here when a deploy, config change or feature flag is sent to the change events webhook.'
              }
              primaryAction={
                filtered || filters.cursor ? (
                  <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                    <Link href="/changes">Clear filters</Link>
                  </Button>
                ) : filters.window !== '30d' ? (
                  <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                    <Link href="/changes?window=30d">Show the last 30 days</Link>
                  </Button>
                ) : canManage ? (
                  <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                    <Link href="/settings/intelligence/services#change-sources">
                      Set up change sources
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          }
          footer={
            <ListPagination
              label="Change pages"
              shown={rows.length}
              onFirstPage={!filters.cursor}
              firstHref={`/changes${listQueryString(query)}`}
              nextHref={
                result.data.nextCursor
                  ? `/changes${listQueryString({ ...query, cursor: result.data.nextCursor })}`
                  : null
              }
            />
          }
        />
      )}

      {canManage && <ChangeMappingSection />}
    </div>
  );
}
