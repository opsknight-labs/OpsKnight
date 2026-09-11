'use client';

import { useMemo } from 'react';
import type { PublicRegionStatus } from '@/lib/status-pages/public-contract';
import { describeRegion } from '@/lib/status-pages/presentation';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadge from '@/components/incident/StatusBadge';

const REGION_LOCATIONS: Record<string, string> = {
  'us-east-1': 'N. Virginia',
  'us-east-2': 'Ohio',
  'us-west-1': 'N. California',
  'us-west-2': 'Oregon',
  'eu-west-1': 'Ireland',
  'eu-west-2': 'London',
  'eu-west-3': 'Paris',
  'eu-central-1': 'Frankfurt',
  'eu-central-2': 'Zurich',
  'eu-north-1': 'Stockholm',
  'eu-south-1': 'Milan',
  'ap-south-1': 'Mumbai',
  'ap-south-2': 'Hyderabad',
  'ap-northeast-1': 'Tokyo',
  'ap-northeast-2': 'Seoul',
  'ap-northeast-3': 'Osaka',
  'ap-southeast-1': 'Singapore',
  'ap-southeast-2': 'Sydney',
  'ap-southeast-3': 'Jakarta',
  'ap-east-1': 'Hong Kong',
  'sa-east-1': 'São Paulo',
  'me-south-1': 'Bahrain',
  'af-south-1': 'Cape Town',
  'ca-central-1': 'Central Canada',
};

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
          const location = REGION_LOCATIONS[region.name.toLowerCase()];

          return (
            <li key={region.name} className="status-v3-region-card">
              <div className="status-v3-region-card__header">
                <span className="status-v3-region-card__name">{region.name}</span>
                {location && <span className="status-v3-region-card__location">{location}</span>}
              </div>
              <div className="status-v3-region-card__status">
                <StatusBadge
                  status={region.status}
                  label={label}
                  size="sm"
                  showDot
                  pulse={!isHealthy}
                />
              </div>
              <div className="status-v3-region-card__footer">
                <span className="status-v3-region-card__desc">{describeRegion(region)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
