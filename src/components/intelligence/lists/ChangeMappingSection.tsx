import { mapChangeValueAction } from '@/app/(app)/changes/actions';
import prisma from '@/lib/prisma';
import {
  listUnmappedChanges,
  UNMAPPED_WINDOW_DAYS,
} from '@/lib/intelligence/changes/service-mapping';

const fieldClass =
  'h-11 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9';
const buttonClass =
  'inline-flex h-11 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9';

type Option = { id: string; name: string };

function ServiceSelect({ id, services }: { id: string; services: Option[] }) {
  return (
    <select id={id} name="serviceId" required className={fieldClass} defaultValue="">
      <option value="" disabled>
        Choose a service
      </option>
      {services.map(service => (
        <option key={service.id} value={service.id}>
          {service.name}
        </option>
      ))}
    </select>
  );
}

/**
 * For intelligence managers on /changes: changes from multi-service integrations whose app/component
 * label matched no service, each mappable in place, and a form to map any label value (adding the first
 * value makes an integration multi-service).
 */
export default async function ChangeMappingSection() {
  const [unmapped, services, integrations, mappings] = await Promise.all([
    listUnmappedChanges(),
    prisma.service.findMany({
      orderBy: { name: 'asc' },
      take: 2000,
      select: { id: true, name: true },
    }),
    prisma.integration.findMany({
      where: { type: 'WEBHOOK' },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, service: { select: { name: true } } },
    }),
    prisma.changeServiceMapping.findMany({
      select: { integrationId: true, version: true, mappings: true },
    }),
  ]);
  const mappingByIntegration = new Map(mappings.map(mapping => [mapping.integrationId, mapping]));

  return (
    <section
      aria-labelledby="change-mapping-heading"
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <h2 id="change-mapping-heading" className="text-base font-semibold">
          Map changes to services
        </h2>
        <p className="text-sm text-muted-foreground">
          One change webhook can carry deploys of many services. Once a webhook has a mapping, each
          change goes to the service its app or component label maps to, then to a Backstage entity
          or service of that name. Changes that match none are listed here and count toward no
          service until mapped.
        </p>
      </div>

      {unmapped.length > 0 ? (
        <ul
          className="divide-y divide-border"
          aria-label={`Unmapped changes, last ${UNMAPPED_WINDOW_DAYS} days`}
        >
          {unmapped.map(group => {
            const id = `map-${group.integrationId}-${group.source}-${group.component ?? 'none'}`;
            return (
              <li key={id} className="flex flex-wrap items-end justify-between gap-3 py-3 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <p className="break-words font-medium">
                    {group.component ?? 'No component label'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {group.integrationName} · {group.source} · {group.count} change
                    {group.count === 1 ? '' : 's'}, latest{' '}
                    {group.latestAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                  </p>
                </div>
                {group.component && (
                  <form
                    action={mapChangeValueAction}
                    className="flex w-full items-end gap-2 sm:w-auto"
                  >
                    <input type="hidden" name="integrationId" value={group.integrationId} />
                    <input type="hidden" name="value" value={group.component} />
                    <label htmlFor={id} className="sr-only">
                      Service for {group.component}
                    </label>
                    <div className="min-w-[12rem] flex-1">
                      <ServiceSelect id={id} services={services} />
                    </div>
                    <button type="submit" className={buttonClass}>
                      Map
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No unmapped changes in the last {UNMAPPED_WINDOW_DAYS} days.
        </p>
      )}

      {integrations.length > 0 && (
        <form
          action={mapChangeValueAction}
          className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
        >
          <div className="min-w-[12rem] flex-1 space-y-1">
            <label
              htmlFor="map-integration"
              className="block text-xs font-medium text-muted-foreground"
            >
              Change webhook
            </label>
            <select
              id="map-integration"
              name="integrationId"
              required
              className={fieldClass}
              defaultValue=""
            >
              <option value="" disabled>
                Choose a webhook
              </option>
              {integrations.map(integration => {
                const mapping = mappingByIntegration.get(integration.id);
                const count = mapping ? Object.keys(mapping.mappings ?? {}).length : 0;
                return (
                  <option key={integration.id} value={integration.id}>
                    {integration.name} ({integration.service.name})
                    {mapping ? ` · ${count} mapped, v${mapping.version}` : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="min-w-[10rem] flex-1 space-y-1">
            <label htmlFor="map-value" className="block text-xs font-medium text-muted-foreground">
              App or component label value
            </label>
            <input id="map-value" name="value" required maxLength={128} className={fieldClass} />
          </div>
          <div className="min-w-[12rem] flex-1 space-y-1">
            <label
              htmlFor="map-service"
              className="block text-xs font-medium text-muted-foreground"
            >
              Service
            </label>
            <ServiceSelect id="map-service" services={services} />
          </div>
          <button type="submit" className={buttonClass}>
            Save mapping
          </button>
        </form>
      )}
    </section>
  );
}
