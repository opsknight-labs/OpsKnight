'use client';

import { useMemo, useState } from 'react';
import type { PublicServiceStatus, PublicStatusService } from '@/lib/status-pages/public-contract';
import { serviceRegionBucket, serviceSearchKey } from '@/lib/status-pages/presentation';
import { STATUS_PRESENTATION, statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadgeV3 from './StatusBadgeV3';
import ServiceHistoryV3 from './ServiceHistoryV3';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'OPERATIONAL', label: STATUS_PRESENTATION.OPERATIONAL.label },
  { key: 'DEGRADED', label: STATUS_PRESENTATION.DEGRADED.label },
  { key: 'PARTIAL_OUTAGE', label: STATUS_PRESENTATION.PARTIAL_OUTAGE.label },
  { key: 'MAJOR_OUTAGE', label: STATUS_PRESENTATION.MAJOR_OUTAGE.label },
  { key: 'MAINTENANCE', label: STATUS_PRESENTATION.MAINTENANCE.label },
  { key: 'UNKNOWN', label: STATUS_PRESENTATION.UNKNOWN.label },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function ServiceRow({ service, timeZone }: { service: PublicStatusService; timeZone: string }) {
  const token = statusPresentation(service.status).token;
  const slaTier = service.sla?.tier ?? service.slaTier;
  return (
    <li className="status-v3-service status-service-card" data-status={token}>
      <div className="status-v3-service__head">
        <span className="status-v3-service__lead">
          <span className={`status-v3-dot status-${token}`} aria-hidden="true" />
          <span className="status-v3-service__name">{service.name}</span>
        </span>
        <StatusBadgeV3 status={service.status} size="sm" />
      </div>
      {service.description && <p className="status-v3-service__desc">{service.description}</p>}
      {(slaTier || service.team?.name || (service.regions?.length ?? 0) > 0) && (
        <div className="status-v3-service__meta">
          {slaTier ? <span className="status-v3-chip">Service tier: {slaTier}</span> : null}
          {service.team?.name ? (
            <span className="status-v3-chip status-v3-chip--muted">
              Owned by {service.team.name}
            </span>
          ) : null}
          {service.regions?.map(region => (
            <span key={region} className="status-v3-chip status-v3-chip--muted">
              {region}
            </span>
          ))}
        </div>
      )}
      {(service.history || service.uptime) && (
        <ServiceHistoryV3 service={service} timeZone={timeZone} />
      )}
    </li>
  );
}

/** Service list from V3. Status, SLA grade and the history bars are all backend-supplied. */
export default function ServiceHealthV3({
  services,
  timeZone,
  groupByRegion = false,
}: {
  services: PublicStatusService[];
  timeZone: string;
  groupByRegion?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return services.filter(service => {
      if (filter !== 'all' && service.status !== (filter as PublicServiceStatus)) return false;
      if (needle && !serviceSearchKey(service).includes(needle)) return false;
      return true;
    });
  }, [services, query, filter]);

  if (services.length === 0) return null;

  const groups = groupByRegion
    ? (() => {
        const buckets = new Map<string, PublicStatusService[]>();
        for (const service of filtered) {
          const region = serviceRegionBucket(service.regions);
          const members = buckets.get(region) ?? [];
          members.push(service);
          buckets.set(region, members);
        }
        return [...buckets.entries()].map(([region, members]) => ({ region, services: members }));
      })()
    : null;

  return (
    <section className="status-v3-services" aria-labelledby="status-v3-services-heading">
      <h2 id="status-v3-services-heading">Services</h2>
      <div className="status-v3-services__bar">
        <label className="status-v3-search">
          <span className="sr-only">Search services</span>
          <input
            type="search"
            placeholder="Search services"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <div className="status-v3-filters" role="group" aria-label="Filter services by status">
          {FILTERS.map(item => (
            <button
              key={item.key}
              type="button"
              className="status-v3-chip"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="status-muted">No services match your filters.</p>
      ) : groups ? (
        groups.map(group => (
          <div key={group.region} className="status-v3-group">
            <h3 className="status-v3-group__title">{group.region}</h3>
            <ul className="status-v3-services__list">
              {group.services.map(service => (
                <ServiceRow key={service.id} service={service} timeZone={timeZone} />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <ul className="status-v3-services__list">
          {filtered.map(service => (
            <ServiceRow key={service.id} service={service} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </section>
  );
}
