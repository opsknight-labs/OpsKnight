import Link from 'next/link';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { ClearOverrideButton, ServicePolicyForm } from '@/components/settings/ServicePolicyForms';
import { Badge } from '@/components/ui/shadcn/badge';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { listServicePolicyOverview } from '@/lib/intelligence/settings/service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SOURCE_LABEL = { service: 'Own policy', global: 'Follows global', default: 'Not configured' } as const;

async function loadRows(search: string) {
  try {
    const actor = await getCurrentAuthorizationActor();
    return await listServicePolicyOverview({ search, serviceWhere: serviceReadWhere(actor) });
  } catch (error) {
    logger.warn('[Intelligence] Service policies could not load', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export default async function IntelligenceServicesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const q = ((await searchParams)?.q ?? '').slice(0, 100);
  const rows = await loadRows(q);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/settings/intelligence" className="text-xs text-muted-foreground hover:underline">
          ← Intelligence
        </Link>
        <h1 className="text-2xl font-semibold">Per-service policies</h1>
        <p className="text-sm text-muted-foreground">
          Services follow the global policy unless you give them their own. An override starts from what currently applies to
          the service and, like every policy, is versioned and audited. Turning an override off never deletes its history.
        </p>
      </header>

      <SettingsSection title="Services" description="Showing the first 50 matches.">
        <form method="get" className="flex gap-2 py-3">
          <label htmlFor="service-search" className="sr-only">
            Search services
          </label>
          <input id="service-search" name="q" defaultValue={q} maxLength={100} placeholder="Search services" className="w-full max-w-sm rounded-md border border-border bg-background p-2 text-sm" />
          <button type="submit" className="rounded-md border border-border px-3 text-sm hover:bg-accent">
            Search
          </button>
        </form>
        {rows === null ? (
          <p className="py-3 text-sm text-muted-foreground">Unavailable.</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No services found.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(row => (
              <li key={row.serviceId} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{row.serviceName}</span>
                    <span className="flex gap-2">
                      <Badge variant={row.effectiveMode === 'OFF' ? 'secondary' : 'default'}>{row.effectiveMode.toLowerCase()}</Badge>
                      <Badge variant="outline">{SOURCE_LABEL[row.source]}</Badge>
                    </span>
                  </summary>
                  <ServicePolicyForm row={row} canManage={canManage} />
                  {canManage && row.source === 'service' && <ClearOverrideButton serviceId={row.serviceId} serviceName={row.serviceName} />}
                </details>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
