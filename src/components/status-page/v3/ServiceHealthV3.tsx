'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicServiceStatus, PublicStatusService } from '@/lib/status-pages/public-contract';
import { serviceRegionBucket, serviceSearchKey } from '@/lib/status-pages/presentation';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadgeV3 from './StatusBadgeV3';
import ServiceHistoryV3 from './ServiceHistoryV3';

type FilterKey = 'all' | 'issues' | PublicServiceStatus;

const IMPACT_ORDER: Record<PublicServiceStatus, number> = {
  MAJOR_OUTAGE: 5,
  PARTIAL_OUTAGE: 4,
  DEGRADED: 3,
  MAINTENANCE: 2,
  UNKNOWN: 1,
  OPERATIONAL: 0,
};

const STATUS_FILTER_ORDER: PublicServiceStatus[] = [
  'MAJOR_OUTAGE',
  'PARTIAL_OUTAGE',
  'DEGRADED',
  'MAINTENANCE',
  'UNKNOWN',
  'OPERATIONAL',
];

function sortByImpact(left: PublicStatusService, right: PublicStatusService) {
  const delta = IMPACT_ORDER[right.status] - IMPACT_ORDER[left.status];
  return delta !== 0 ? delta : left.name.localeCompare(right.name);
}

function serviceMatches(service: PublicStatusService, filter: FilterKey) {
  if (filter === 'all') return true;
  if (filter === 'issues') return service.status !== 'OPERATIONAL';
  return service.status === filter;
}

function ServiceRow({ service, timeZone }: { service: PublicStatusService; timeZone: string }) {
  const token = statusPresentation(service.status).token;
  const slaTier = service.sla?.tier ?? service.slaTier;
  const hasDetails = Boolean(slaTier || service.team?.name || (service.regions?.length ?? 0) > 0);
  const affected = service.status !== 'OPERATIONAL';

  return (
    <li
      className={`status-v3-service status-service-card${affected ? ' status-v3-service--affected' : ''}`}
      data-status={token}
    >
      <div className="status-v3-service__head">
        <div className="status-v3-service__copy">
          <span className="status-v3-service__name">{service.name}</span>
          {service.description && <p className="status-v3-service__desc">{service.description}</p>}
        </div>
        <StatusBadgeV3 status={service.status} size="sm" />
      </div>
      {hasDetails && (
        <details className="status-v3-service__details">
          <summary>Details</summary>
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
        </details>
      )}
      {(service.history || service.uptime) && (
        <ServiceHistoryV3 service={service} timeZone={timeZone} />
      )}
    </li>
  );
}

function ServiceList({
  services,
  timeZone,
}: {
  services: PublicStatusService[];
  timeZone: string;
}) {
  return (
    <ul className="status-v3-services__list">
      {services.map(service => (
        <ServiceRow key={service.id} service={service} timeZone={timeZone} />
      ))}
    </ul>
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
  const [groupRegions, setGroupRegions] = useState(groupByRegion);

  useEffect(() => {
    setGroupRegions(groupByRegion);
  }, [groupByRegion]);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return services;
    return services.filter(service => serviceSearchKey(service).includes(needle));
  }, [services, query]);

  const presentStatuses = useMemo(() => {
    const seen = new Set(searched.map(service => service.status));
    return STATUS_FILTER_ORDER.filter(status => seen.has(status));
  }, [searched]);

  const issueCount = searched.filter(service => service.status !== 'OPERATIONAL').length;
  const canGroup = services.some(service => (service.regions?.length ?? 0) > 0);

  const filtered = useMemo(() => {
    return [...searched.filter(service => serviceMatches(service, filter))].sort(sortByImpact);
  }, [searched, filter]);

  if (services.length === 0) return null;

  const grouped = groupRegions && canGroup;

  const groups = grouped
    ? (() => {
        const buckets = new Map<string, PublicStatusService[]>();
        for (const service of filtered) {
          const region = serviceRegionBucket(service.regions);
          const members = buckets.get(region) ?? [];
          members.push(service);
          buckets.set(region, members);
        }
        return [...buckets.entries()]
          .map(([region, members]) => ({
            region,
            services: [...members].sort(sortByImpact),
          }))
          .sort((left, right) => {
            const leftRank = Math.max(...left.services.map(service => IMPACT_ORDER[service.status]));
            const rightRank = Math.max(
              ...right.services.map(service => IMPACT_ORDER[service.status])
            );
            return rightRank - leftRank || left.region.localeCompare(right.region);
          });
      })()
    : null;

  return (
    <section className="status-v3-services" aria-labelledby="status-v3-services-heading">
      <header className="status-v3-services__head">
        <h2 id="status-v3-services-heading">Services</h2>
        <p
          className="status-v3-services__tally"
          aria-label={`${filtered.length} of ${services.length} services`}
        >
          <strong>{filtered.length}</strong>
          <span> of {services.length}</span>
        </p>
      </header>
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
        <div className="status-v3-services__instruments">
          <label className="status-v3-filter">
            <span className="sr-only">Filter by status</span>
            <select
              value={filter}
              onChange={event => setFilter(event.target.value as FilterKey)}
            >
              <option value="all">All</option>
              {issueCount > 0 ? <option value="issues">Issues ({issueCount})</option> : null}
              {presentStatuses.map(status => (
                <option key={status} value={status}>
                  {statusPresentation(status).label}
                </option>
              ))}
            </select>
          </label>
          {canGroup ? (
            <button
              type="button"
              className="status-v3-services__group"
              aria-pressed={groupRegions}
              onClick={() => setGroupRegions(open => !open)}
            >
              Group by region
            </button>
          ) : null}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="status-muted">No services match your filters.</p>
      ) : groups ? (
        groups.map(group => (
          <div key={group.region} className="status-v3-group">
            <h3 className="status-v3-group__title">{group.region}</h3>
            <ServiceList services={group.services} timeZone={timeZone} />
          </div>
        ))
      ) : (
        <ServiceList services={filtered} timeZone={timeZone} />
      )}
    </section>
  );
}
