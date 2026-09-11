'use client';

import { useMemo } from 'react';
import type { PublicRegionStatus } from '@/lib/status-pages/public-contract';
import { describeRegion } from '@/lib/status-pages/presentation';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadge from '@/components/incident/StatusBadge';

/**
 * Clean, elegant region health overview.
 * Positioned above services to give visitors an immediate geographic pulse.
 * Fits seamlessly across mobile, tablet, and wide screens.
 */
export default function RegionHealthV3({ regions }: { regions: PublicRegionStatus[] }) {
  const { impactedCount, totalCount } = useMemo(() => {
    if (!regions || regions.length === 0) return { impactedCount: 0, totalCount: 0 };
    let impacted = 0;
    for (const r of regions) {
      if (r.status !== 'OPERATIONAL') impacted++;
    }
    return { impactedCount: impacted, totalCount: regions.length };
  }, [regions]);

  if (!regions || regions.length === 0) return null;

  return (
    <section className="status-v3-regions" aria-labelledby="status-v3-regions-heading">
      <header className="status-v3-regions__head">
        <h2 id="status-v3-regions-heading">Regions</h2>
        <p
          className="status-v3-regions__tally"
          aria-label={`${regions.length - impactedCount} of ${totalCount} regions fully operational`}
        >
          {impactedCount === 0 ? (
            <>
              <strong>{totalCount}</strong>
              <span> of {totalCount} operational</span>
            </>
          ) : (
            <>
              <strong className="status-v3-regions__tally-impacted">{impactedCount}</strong>
              <span> of {totalCount} impacted</span>
            </>
          )}
        </p>
      </header>

      <ul className="status-v3-regions__grid">
        {regions.map(region => {
          const isHealthy = region.status === 'OPERATIONAL';
          const label = statusPresentation(region.status).label;

          return (
            <li key={region.name} className="status-v3-region-card">
              <div className="status-v3-region-card__head">
                <span className="status-v3-region-card__name">{region.name}</span>
                <StatusBadge
                  status={region.status}
                  label={label}
                  size="xs"
                  showDot
                  pulse={!isHealthy}
                />
              </div>
              <div className="status-v3-region-card__sub">
                <span className="status-v3-region-card__desc">{describeRegion(region)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
