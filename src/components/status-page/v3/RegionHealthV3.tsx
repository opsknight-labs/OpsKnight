import type { PublicRegionStatus } from '@/lib/status-pages/public-contract';
import { describeRegion } from '@/lib/status-pages/presentation';
import StatusBadgeV3 from './StatusBadgeV3';

/** Region health from V3 aggregation — the frontend never computes a region's worst status. */
export default function RegionHealthV3({ regions }: { regions: PublicRegionStatus[] }) {
  if (regions.length === 0) return null;
  return (
    <section className="status-v3-regions" aria-labelledby="status-v3-regions-heading">
      <h2 id="status-v3-regions-heading">Regions</h2>
      <ul className="status-v3-regions__list">
        {regions.map(region => (
          <li key={region.name} className="status-v3-region">
            <div className="status-v3-region__head">
              <span className="status-v3-region__name">{region.name}</span>
              <StatusBadgeV3 status={region.status} size="sm" />
            </div>
            <span className="status-muted">{describeRegion(region)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
