import Link from 'next/link';
import { GitCommitHorizontal } from 'lucide-react';
import ChangeMappingSection from '@/components/intelligence/lists/ChangeMappingSection';
import ChangesTable from '@/components/intelligence/lists/ChangesTable';
import ListFilterBar from '@/components/intelligence/lists/ListFilterBar';
import { ListPagination } from '@/components/intelligence/lists/shared';
import { SectionError, actionLinkClass } from '@/components/intelligence/overview/primitives';
import EmptyState from '@/components/ui/EmptyState';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { listChangesForActor } from '@/lib/intelligence/lists/changes';
import {
  CHANGE_RISK_OPTIONS,
  DEFAULT_LIST_WINDOW,
  LIST_WINDOWS,
  listQueryString,
  parseChangeListFilters,
  type ListParam,
} from '@/lib/intelligence/lists/contract';
import { loadSection } from '@/lib/intelligence/overview';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = { title: 'Changes' };

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
  const result = await loadSection('changes', () => listChangesForActor(actor, filters));

  const query = {
    service: filters.serviceId,
    source: filters.source,
    risk: filters.risk,
    window: filters.window,
  };
  const filtered = Boolean(filters.serviceId || filters.source || filters.risk);
  const services = result.ok ? result.data.services : [];
  const serviceOptions = services.map(service => ({ value: service.id, label: service.name }));
  if (filters.serviceId && !services.some(service => service.id === filters.serviceId))
    serviceOptions.push({ value: filters.serviceId, label: 'Selected service' });
  const sources = result.ok ? [...result.data.sources] : [];
  if (filters.source && !sources.includes(filters.source)) sources.push(filters.source);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <header className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Changes</h1>
        <p className="text-sm text-muted-foreground">
          Deploys, config changes, feature flags and infrastructure changes sent to OpsKnight,
          newest first. Risk is a ranking signal to help you look in the right place; it never
          establishes that a change caused an incident.
        </p>
      </header>

      <ListFilterBar
        basePath="/changes"
        label="Filter changes"
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
            name: 'source',
            label: 'Source',
            value: filters.source ?? '',
            anyLabel: 'Any source',
            options: sources.map(value => ({ value, label: value })),
          },
          {
            name: 'risk',
            label: 'Risk',
            value: filters.risk ?? '',
            anyLabel: 'Any risk',
            options: CHANGE_RISK_OPTIONS,
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
      ) : result.data.rows.length === 0 ? (
        <EmptyState
          icon={<GitCommitHorizontal aria-hidden="true" />}
          title={filtered ? 'No changes match these filters' : 'No changes in this time range'}
          description={
            filtered
              ? 'Try a wider time range or remove a filter.'
              : 'Changes appear here when a deploy, config change or feature flag is sent to the change events webhook. Try a wider time range.'
          }
          action={
            filtered || filters.cursor ? (
              <Link href="/changes" className={actionLinkClass}>
                Clear filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <ChangesTable rows={result.data.rows} />
          {result.data.linksTruncated && (
            <p className="text-xs text-muted-foreground">
              Linked incidents are taken from the 500 most recent incidents in this page&apos;s time
              span, so some links may be missing.
            </p>
          )}
          {result.data.servicesTruncated && (
            <p className="text-xs text-muted-foreground">
              The service filter lists the first 200 services by name.
            </p>
          )}
          <ListPagination
            label="Change pages"
            shown={result.data.rows.length}
            onFirstPage={!filters.cursor}
            firstHref={`/changes${listQueryString(query)}`}
            nextHref={
              result.data.nextCursor
                ? `/changes${listQueryString({ ...query, cursor: result.data.nextCursor })}`
                : null
            }
          />
        </>
      )}

      {canManage && <ChangeMappingSection />}
    </div>
  );
}
