'use client';

import React, { useMemo, useState } from 'react';
import type { SLAMetrics } from '@/lib/sla';
import { formatTimeMinutesMs } from '@/lib/time-format';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

type SortField = 'name' | 'count' | 'mtta' | 'mttr' | 'status' | 'breaches';
type SortDirection = 'asc' | 'desc';

type SortOption = {
  value: string;
  label: string;
  field: SortField;
  direction: SortDirection;
};

const sortOptions: SortOption[] = [
  { value: 'count-desc', label: 'Incidents (high to low)', field: 'count', direction: 'desc' },
  { value: 'mtta-asc', label: 'MTTA (fastest first)', field: 'mtta', direction: 'asc' },
  { value: 'mttr-asc', label: 'MTTR (fastest first)', field: 'mttr', direction: 'asc' },
  {
    value: 'breaches-desc',
    label: 'SLA breaches (high to low)',
    field: 'breaches',
    direction: 'desc',
  },
  { value: 'name-asc', label: 'Service name (A-Z)', field: 'name', direction: 'asc' },
  { value: 'status-desc', label: 'Health (critical first)', field: 'status', direction: 'desc' },
];

export default function ServiceHealthTable({
  services,
}: {
  services: SLAMetrics['serviceMetrics'];
}) {
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>('count-desc');

  const counts = useMemo(() => {
    return services.reduce(
      (acc, s) => {
        if (s.status === 'Healthy') acc.healthy += 1;
        else if (s.status === 'Degraded') acc.degraded += 1;
        else if (s.status === 'Critical') acc.critical += 1;
        return acc;
      },
      { healthy: 0, degraded: 0, critical: 0 }
    );
  }, [services]);

  const filteredAndSortedServices = useMemo(() => {
    let result = [...services];

    if (statusFilter) {
      result = result.filter(service => service.status === statusFilter);
    }

    const activeSort = sortOptions.find(option => option.value === sortKey) ?? sortOptions[0];
    const severity = { Critical: 3, Degraded: 2, Healthy: 1, Unknown: 0 };

    result.sort((a, b) => {
      let valA: number | string = a[activeSort.field as keyof typeof a];
      let valB: number | string = b[activeSort.field as keyof typeof b];

      if (activeSort.field === 'status') {
        valA = severity[a.status as keyof typeof severity] || 0;
        valB = severity[b.status as keyof typeof severity] || 0;
      }

      if (valA < valB) return activeSort.direction === 'asc' ? -1 : 1;
      if (valA > valB) return activeSort.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [services, statusFilter, sortKey]);

  const totalServices = services.length;

  return (
    <div className="service-health-panel">
      <div className="service-health-controls">
        <div className="service-health-filters">
          <button
            className={`service-health-filter ${statusFilter === null ? 'is-active' : ''}`}
            onClick={() => setStatusFilter(null)}
          >
            All <strong>{totalServices}</strong>
          </button>
          <button
            className={`service-health-filter is-healthy ${statusFilter === 'Healthy' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'Healthy' ? null : 'Healthy')}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Healthy <strong>{counts.healthy}</strong>
          </button>
          <button
            className={`service-health-filter is-degraded ${statusFilter === 'Degraded' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'Degraded' ? null : 'Degraded')}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Degraded <strong>{counts.degraded}</strong>
          </button>
          <button
            className={`service-health-filter is-critical ${statusFilter === 'Critical' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'Critical' ? null : 'Critical')}
          >
            <XCircle className="w-3.5 h-3.5" /> Critical <strong>{counts.critical}</strong>
          </button>
        </div>
        <div className="service-health-sort">
          <span>Sort</span>
          <select value={sortKey} onChange={event => setSortKey(event.target.value)}>
            {sortOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="service-health-grid">
        {filteredAndSortedServices.map(service => (
          <article key={service.id} className="service-health-card">
            <div className="service-health-card-header">
              <div className="service-health-name">{service.name}</div>
              <span className={`service-health-pill status-${service.status.toLowerCase()}`}>
                {service.status}
              </span>
            </div>
            <div className="service-health-metrics">
              <div>
                <span>Incidents</span>
                <strong>{service.count.toLocaleString()}</strong>
              </div>
              <div>
                <span>MTTA</span>
                <strong>{formatTimeMinutesMs(service.mtta * 60000)}</strong>
              </div>
              <div>
                <span>MTTR</span>
                <strong>{formatTimeMinutesMs(service.mttr * 60000)}</strong>
              </div>
              <div>
                <span>SLA breaches</span>
                <strong>{service.slaBreaches.toLocaleString()}</strong>
              </div>
            </div>
          </article>
        ))}

        {filteredAndSortedServices.length === 0 && (
          <div className="service-health-empty">No services match the current filter.</div>
        )}
      </div>
    </div>
  );
}
