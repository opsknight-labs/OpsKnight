import Link from 'next/link';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { IntelligenceGroupHeader } from '@/components/settings/layout/IntelligenceGroupHeader';
import DependenciesChangesSections from '../_sections/DependenciesChangesSections';
import { ClearOverrideButton, ServicePolicyForm } from '@/components/settings/ServicePolicyForms';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import EmptyState from '@/components/patterns/EmptyState';
import { LearnMore } from '@/components/settings/layout/LearnMore';
import { Bot, ChevronRight, Layers, Search } from 'lucide-react';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { listServicePolicyOverview } from '@/lib/intelligence/settings/service';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SOURCE_LABEL = {
  service: 'Own policy',
  global: 'Follows global',
  default: 'Not configured',
} as const;

async function loadRows(search: string) {
  try {
    const actor = await getCurrentAuthorizationActor();
    return await listServicePolicyOverview({ search, serviceWhere: serviceReadWhere(actor) });
  } catch (error) {
    logger.warn('[Intelligence] Service policies could not load', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default async function IntelligenceServicesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  await requirePageAccess('/settings/intelligence/services');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const q = ((await searchParams)?.q ?? '').slice(0, 100);
  const rows = await loadRows(q);

  return (
    <div className="space-y-6">
      <IntelligenceGroupHeader
        group="services"
        about={
          <p>
            What each service does with intelligence, and the inputs probable-cause suggestions rely
            on: dependencies, topology sources and recorded changes. Alert quality lives here and
            nowhere else. Everything on this page is advisory: nothing pages, mutes or runs
            automatically.
          </p>
        }
      >
        Per-service policies and the inputs probable-cause suggestions rely on.
      </IntelligenceGroupHeader>

      <SettingsSection
        id="service-policies"
        title="Per-service policies"
        description="Services follow the global policy unless you give them their own. Overrides are versioned and audited."
      >
        <LearnMore className="pt-3">
          An override starts from what currently applies to the service. Turning an override off
          never deletes its history. The list shows the first 50 matches.
        </LearnMore>
        <form method="get" role="search" className="flex flex-col gap-2 py-3 sm:flex-row">
          <label htmlFor="service-search" className="sr-only">
            Search services
          </label>
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="service-search"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={100}
              placeholder="Search services"
              className="min-h-11 pl-9 sm:min-h-10"
            />
          </div>
          <Button type="submit" variant="outline" className="min-h-11 sm:min-h-10">
            Search
          </Button>
        </form>
        {rows === null ? (
          <EmptyState
            size="sm"
            variant="simple"
            title="Service policies unavailable"
            description="They could not be loaded. Refresh to try again."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            size="sm"
            variant="simple"
            icon={<Layers aria-hidden="true" />}
            title={q ? 'No services match' : 'No services yet'}
            description={
              q
                ? 'Try another name, or clear the search to see every service.'
                : 'Create a service first; its intelligence policy is set here.'
            }
            primaryAction={
              q ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/intelligence/services">Clear search</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="mb-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rows.map(row => (
              <li key={row.serviceId}>
                <details className="group/service">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2">
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open/service:rotate-90 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                      <span className="truncate text-sm font-medium text-foreground">
                        {row.serviceName}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <Badge variant={row.effectiveMode === 'OFF' ? 'secondary' : 'default'}>
                        {row.effectiveMode.toLowerCase()}
                      </Badge>
                      <Badge variant="outline">{SOURCE_LABEL[row.source]}</Badge>
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-border bg-muted/20 px-3 pb-4">
                    <ServicePolicyForm row={row} canManage={canManage} />
                    <div className="flex flex-wrap items-center gap-2">
                      {canManage && row.source === 'service' && (
                        <ClearOverrideButton
                          serviceId={row.serviceId}
                          serviceName={row.serviceName}
                        />
                      )}
                      <Button asChild variant="ghost" size="sm" className="min-h-11 sm:min-h-9">
                        <Link
                          href={`/settings/intelligence/services/${encodeURIComponent(row.serviceId)}/squire`}
                        >
                          <Bot aria-hidden="true" />
                          Squire: proactive help and learned facts
                        </Link>
                      </Button>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <DependenciesChangesSections canManage={canManage} />
    </div>
  );
}
