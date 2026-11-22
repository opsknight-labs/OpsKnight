import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertOctagon,
  AlertTriangle,
  BellOff,
  BellRing,
  Info,
  SlidersHorizontal,
} from 'lucide-react';
import AlertsTable from '@/components/intelligence/lists/AlertsTable';
import ListFilterBar from '@/components/intelligence/lists/ListFilterBar';
import { ListPagination } from '@/components/intelligence/lists/shared';
import { NO_VALUE, SectionError } from '@/components/intelligence/overview/primitives';
import { EmptyState, PageHeader } from '@/components/patterns';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import type { FilterChipTone } from '@/components/patterns/FilterBar';
import { Button } from '@/components/ui/shadcn/button';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { countAlertsForActor, listAlertsForActor } from '@/lib/intelligence/lists/alerts';
import {
  ALERT_DECISION_OPTIONS,
  ALERT_SEVERITIES,
  DEFAULT_LIST_WINDOW,
  LIST_WINDOWS,
  listQueryString,
  parseAlertListFilters,
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

export const metadata = { title: 'Alerts' };

/** One chip per `ALERT_SEVERITIES` value, in the same order. */
const SEVERITY_CHIPS: ReadonlyArray<{
  value: (typeof ALERT_SEVERITIES)[number];
  label: string;
  tone: FilterChipTone;
  icon: ReactNode;
}> = [
  { value: 'critical', label: 'Critical', tone: 'critical', icon: <AlertOctagon /> },
  { value: 'error', label: 'Error', tone: 'elevated', icon: <AlertTriangle /> },
  { value: 'warning', label: 'Warning', tone: 'elevated', icon: <AlertTriangle /> },
  { value: 'info', label: 'Info', tone: 'info', icon: <Info /> },
];

/**
 * Every alert the viewer may read, newest first, with what the noise controls did to it. Read-only: a
 * row opens the alert, and the decision itself is changed where the rule lives.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, ListParam>>;
}) {
  await requirePageAccess('/alerts');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const actor = await getCurrentAuthorizationActor();
  const filters = parseAlertListFilters((await searchParams) ?? {});
  const [result, total] = await Promise.all([
    loadSection('alerts', () => listAlertsForActor(actor, filters)),
    loadSection('alert count', () => countAlertsForActor(actor, filters)),
  ]);

  const query = {
    q: filters.q,
    service: filters.serviceId,
    severity: filters.severity,
    decision: filters.decision,
    window: filters.window,
  };
  const filtered = Boolean(filters.serviceId || filters.severity || filters.decision || filters.q);
  const services = result.ok ? result.data.services : [];
  const serviceOptions = services.map(service => ({ value: service.id, label: service.name }));
  if (filters.serviceId && !services.some(service => service.id === filters.serviceId))
    serviceOptions.push({ value: filters.serviceId, label: 'Selected service' });
  const rows = result.ok ? result.data.rows : [];
  const windowLabel = overviewWindowSpec(filters.window).label;
  const heldBack = rows.filter(row => row.decision?.applied).length;
  const withIncident = rows.filter(row => row.incidentId).length;
  const totalCount = total.ok ? total.data : null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 sm:space-y-6">
      <PageHeader
        eyebrow="AIOps"
        title="Alerts"
        icon={BellRing}
        description="Alerts received from your integrations, newest first, with what the noise controls did before anyone was paged."
        primaryAction={
          canManage ? (
            <Button asChild size="sm" className={cn('h-11 sm:h-9', pageHeaderActionClass)}>
              <Link href="/settings/intelligence/noise-controls">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                Noise controls
              </Link>
            </Button>
          ) : undefined
        }
        stats={[
          {
            label: filtered ? 'Matching alerts' : 'Alerts',
            value: totalCount === null ? NO_VALUE : formatCount(totalCount),
            subtext: !total.ok
              ? 'Count unavailable'
              : totalCount === null
                ? 'Not counted with a decision filter'
                : windowLabel,
          },
          { label: 'On this page', value: formatCount(rows.length), subtext: 'Newest first' },
          {
            label: 'Held back',
            value: formatCount(heldBack),
            subtext: 'By noise controls, this page',
          },
          {
            label: 'Opened an incident',
            value: formatCount(withIncident),
            subtext: 'On this page',
          },
        ]}
      />

      <ListFilterBar
        basePath="/alerts"
        label="Filter alerts"
        description="Search, then narrow by severity, service, noise decision or time range."
        defaults={{ window: DEFAULT_LIST_WINDOW }}
        search={{
          value: filters.q ?? '',
          label: 'Search alerts',
          placeholder: 'Search summary, dedup key, resource or service…',
        }}
        chips={{
          name: 'severity',
          label: 'Severity',
          value: filters.severity ?? '',
          anyLabel: 'Any severity',
          options: SEVERITY_CHIPS,
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
            name: 'decision',
            label: 'Noise decision',
            value: filters.decision ?? '',
            anyLabel: 'Any decision',
            options: ALERT_DECISION_OPTIONS,
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
        <AlertsTable
          rows={rows}
          timeZone={getUserTimeZone(user)}
          summary={`${formatCount(rows.length)} on this page${
            totalCount === null ? '' : ` · ${formatCount(totalCount)} matching`
          } · ${windowLabel.toLowerCase()}`}
          notice={
            result.data.servicesTruncated && (
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                The service filter lists the first 200 services by name.
              </p>
            )
          }
          empty={
            !result.data.nextCursor && (
              <EmptyState
                variant="simple"
                icon={<BellOff aria-hidden="true" />}
                title={filtered ? 'No alerts match these filters' : 'No alerts in this time range'}
                description={
                  filtered
                    ? 'Try a wider time range, a different search or remove a filter.'
                    : 'Alerts appear here as soon as an integration sends one.'
                }
                primaryAction={
                  filtered || filters.cursor ? (
                    <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                      <Link href="/alerts">Clear filters</Link>
                    </Button>
                  ) : filters.window !== '30d' ? (
                    <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                      <Link href="/alerts?window=30d">Show the last 30 days</Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                      <Link href="/services">Connect an integration on a service</Link>
                    </Button>
                  )
                }
              />
            )
          }
          footer={
            <ListPagination
              label="Alert pages"
              shown={rows.length}
              onFirstPage={!filters.cursor}
              firstHref={`/alerts${listQueryString(query)}`}
              nextHref={
                result.data.nextCursor
                  ? `/alerts${listQueryString({ ...query, cursor: result.data.nextCursor })}`
                  : null
              }
            />
          }
        />
      )}
    </div>
  );
}
