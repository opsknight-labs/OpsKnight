'use client';

import { useMemo } from 'react';
import type { PublicRegionStatus } from '@/lib/status-pages/public-contract';
import { describeRegion } from '@/lib/status-pages/presentation';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadge from '@/components/incident/StatusBadge';

/**
 * Clean, robust, modern rectangular region health card.
 * Positioned above services to give visitors an immediate geographic pulse.
 * Fits seamlessly across mobile, tablet, and wide screens with zero text collisions.
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
    <section className="status-v3-regions-inline" aria-labelledby="status-v3-regions-heading">
      <div className="status-v3-regions-inline__head">
        <div className="status-v3-regions-inline__title-wrap">
          <h2 id="status-v3-regions-heading" className="status-v3-regions-inline__title">
            Regions
          </h2>
          <span className="status-v3-regions-inline__subtitle">Geographic availability</span>
        </div>
        <div
          className="status-v3-regions-inline__tally"
          aria-label={`${regions.length - impactedCount} of ${totalCount} regions fully operational`}
        >
          {impactedCount === 0 ? (
            <span className="status-v3-regions-inline__tally-pill status-v3-regions-inline__tally-pill--healthy">
              <span className="status-v3-regions-inline__dot" aria-hidden="true" />
              All operational
            </span>
          ) : (
            <span className="status-v3-regions-inline__tally-pill status-v3-regions-inline__tally-pill--impacted">
              <span className="status-v3-regions-inline__dot" aria-hidden="true" />
              {impactedCount} of {totalCount} affected
            </span>
          )}
        </div>
      </div>

      <div className="status-v3-regions-inline__list" role="list">
        {regions.map(region => {
          const isHealthy = region.status === 'OPERATIONAL';
          const label = statusPresentation(region.status).label;
          const desc = describeRegion(region);

          return (
            <div
              key={region.name}
              className={`status-v3-region-pill${!isHealthy ? ' status-v3-region-pill--impacted' : ''}`}
              data-status={region.status}
              role="listitem"
              title={`${region.name}: ${desc}`}
            >
              <div className="status-v3-region-pill__lead">
                <svg
                  className="status-v3-region-pill__icon"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                  <path d="M2 12h20" />
                </svg>
                <span className="status-v3-region-pill__name">{region.name}</span>
                <span className="status-v3-region-pill__divider" aria-hidden="true" />
              </div>
              <div className="status-v3-region-pill__status">
                <StatusBadge
                  status={region.status}
                  label={label}
                  size="xs"
                  showDot
                  pulse={!isHealthy}
                />
                <span className="sr-only">{desc}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
