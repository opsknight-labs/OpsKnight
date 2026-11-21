import Link from 'next/link';
import { BellOff } from 'lucide-react';
import AlertsTable from '@/components/intelligence/lists/AlertsTable';
import ListFilterBar from '@/components/intelligence/lists/ListFilterBar';
import { ListPagination } from '@/components/intelligence/lists/shared';
import { SectionError, actionLinkClass } from '@/components/intelligence/overview/primitives';
import EmptyState from '@/components/ui/EmptyState';
import { CAPABILITIES } from '@/lib/authorization';
import { listAlertsForActor } from '@/lib/intelligence/lists/alerts';
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
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = { title: 'Alerts' };

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
  await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const actor = await getCurrentAuthorizationActor();
  const filters = parseAlertListFilters((await searchParams) ?? {});
  const result = await loadSection('alerts', () => listAlertsForActor(actor, filters));

  const query = {
    service: filters.serviceId,
    severity: filters.severity,
    decision: filters.decision,
    window: filters.window,
  };
  const filtered = Boolean(filters.serviceId || filters.severity || filters.decision);
  const services = result.ok ? result.data.services : [];
  const serviceOptions = services.map(service => ({ value: service.id, label: service.name }));
  if (filters.serviceId && !services.some(service => service.id === filters.serviceId))
    serviceOptions.push({ value: filters.serviceId, label: 'Selected service' });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <header className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Alerts received from your integrations, newest first, with what the noise controls did
          before anyone was paged.
        </p>
      </header>

      <ListFilterBar
        basePath="/alerts"
        label="Filter alerts"
        defaults={{ window: DEFAULT_LIST_WINDOW }}
        fields={[
          {
            name: 'service',
            label: 'Service',
            value: filters.serviceId ?? '',
            anyLabel: 'All services',
            options: serviceOptions,
          },
          {
            name: 'severity',
            label: 'Severity',
            value: filters.severity ?? '',
            anyLabel: 'Any severity',
            options: ALERT_SEVERITIES.map(value => ({
              value,
              label: value[0].toUpperCase() + value.slice(1),
            })),
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
      ) : result.data.rows.length === 0 && !result.data.nextCursor ? (
        <EmptyState
          icon={<BellOff aria-hidden="true" />}
          title={filtered ? 'No alerts match these filters' : 'No alerts in this time range'}
          description={
            filtered
              ? 'Try a wider time range or remove a filter.'
              : 'Alerts appear here as soon as an integration sends one. Try a wider time range.'
          }
          action={
            filtered || filters.cursor ? (
              <Link href="/alerts" className={actionLinkClass}>
                Clear filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {result.data.rows.length > 0 && <AlertsTable rows={result.data.rows} />}
          {result.data.servicesTruncated && (
            <p className="text-xs text-muted-foreground">
              The service filter lists the first 200 services by name.
            </p>
          )}
          <ListPagination
            label="Alert pages"
            shown={result.data.rows.length}
            onFirstPage={!filters.cursor}
            firstHref={`/alerts${listQueryString(query)}`}
            nextHref={
              result.data.nextCursor
                ? `/alerts${listQueryString({ ...query, cursor: result.data.nextCursor })}`
                : null
            }
          />
        </>
      )}
    </div>
  );
}
