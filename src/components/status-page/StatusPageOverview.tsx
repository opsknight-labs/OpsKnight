'use client';

import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/timezone';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';

/**
 * The three-figure summary a visitor should be able to read in about three seconds: what the
 * overall state is, how much of the estate it covers, and whether anyone is working on it.
 */
export default function StatusPageOverview({
  snapshot,
  activeIncidentCount,
  windowIncidentCount,
}: {
  snapshot: PublicStatusPageSnapshot;
  activeIncidentCount: number;
  windowIncidentCount: number;
}) {
  const { overall, services, regions } = snapshot;
  const affected = services.filter(
    service => service.status !== 'OPERATIONAL' && service.status !== 'UNKNOWN'
  ).length;

  // Resolved client-side so the reader sees their own clock, matching the daily history. Null on
  // the server keeps the markup deterministic across hydration.
  const [updatedLabel, setUpdatedLabel] = useState<string | null>(null);
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setUpdatedLabel(
      formatDateTime(snapshot.generatedAt, timeZone, { format: 'short', hour12: true })
    );
  }, [snapshot.generatedAt]);

  return (
    <section className="status-overview status-panel" aria-labelledby="status-overview-heading">
      <div className="status-overview__banner">
        <h2 id="status-overview-heading" aria-live="polite">
          {overall.headline}
        </h2>
        {updatedLabel && (
          <span className="status-muted" suppressHydrationWarning>
            Last updated {updatedLabel}
          </span>
        )}
        {overall.note && (
          <span className="status-overview__note">
            <span aria-hidden="true">?</span> {overall.note}
          </span>
        )}
      </div>

      <dl className="status-overview__stats">
        <div className="status-stat">
          <dt className="status-stat__label">Services</dt>
          <dd className="status-stat__value">{services.length}</dd>
          <dd className="status-stat__hint">
            {affected === 0 ? 'None affected' : `${affected} affected`}
            {overall.unknownServiceCount > 0 ? ` · ${overall.unknownServiceCount} unverified` : ''}
          </dd>
        </div>
        <div className="status-stat">
          <dt className="status-stat__label">Active incidents</dt>
          <dd className="status-stat__value">{activeIncidentCount}</dd>
          <dd className="status-stat__hint">
            {`Last ${snapshot.historyDays} days: ${windowIncidentCount}`}
          </dd>
        </div>
        <div className="status-stat">
          <dt className="status-stat__label">Regions</dt>
          <dd className="status-stat__value">{regions.length}</dd>
          <dd className="status-stat__hint">
            {regions.length === 0
              ? 'No regions recorded'
              : `${regions.filter(region => region.impactedServices === 0).length} fully healthy`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
