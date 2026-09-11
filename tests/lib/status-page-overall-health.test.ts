import { describe, expect, it } from 'vitest';
import {
  PUBLIC_SERVICE_STATUSES,
  type PublicServiceStatus,
} from '@/lib/status-pages/public-contract';
import {
  deriveOverallPublicHealth,
  worstKnownPublicStatus,
} from '@/lib/status-pages/status-presentation';

const services = (...statuses: PublicServiceStatus[]) => statuses.map(status => ({ status }));
const repeat = (status: PublicServiceStatus, count: number) =>
  Array.from({ length: count }, () => ({ status }));

describe('deriveOverallPublicHealth', () => {
  it('reports an empty page as having nothing published', () => {
    const result = deriveOverallPublicHealth([]);
    expect(result).toMatchObject({
      status: 'OPERATIONAL',
      confidence: 'complete',
      headline: 'No services published',
      note: null,
    });
  });

  it('uses a systems-level headline when every known service is healthy', () => {
    expect(deriveOverallPublicHealth(services('OPERATIONAL', 'OPERATIONAL')).headline).toBe(
      'All systems operational'
    );
    expect(deriveOverallPublicHealth(services('OPERATIONAL')).headline).toBe(
      'All systems operational'
    );
  });

  it('reports no status at all when nothing can be verified', () => {
    const result = deriveOverallPublicHealth(services('UNKNOWN', 'UNKNOWN'));
    expect(result.status).toBe('UNKNOWN');
    expect(result.confidence).toBe('none');
    expect(result.headline).toBe('Current status unavailable');
    expect(result.note).toContain('could not verify');
  });

  it('qualifies an otherwise healthy page rather than calling it unknown', () => {
    // Nine healthy services and one unverifiable one is not an outage, and saying so overstated
    // the problem; silently dropping the tenth understated it.
    const result = deriveOverallPublicHealth([...repeat('OPERATIONAL', 9), { status: 'UNKNOWN' }]);
    expect(result.status).toBe('OPERATIONAL');
    expect(result.confidence).toBe('partial');
    expect(result.headline).toBe('All known systems operational');
    expect(result.note).toBe('Status unverified for 1 additional service.');
  });

  it('keeps a real outage visible alongside missing signal', () => {
    const result = deriveOverallPublicHealth([
      ...repeat('OPERATIONAL', 8),
      { status: 'UNKNOWN' },
      { status: 'MAJOR_OUTAGE' },
    ]);
    expect(result.status).toBe('MAJOR_OUTAGE');
    expect(result.headline).toBe('One service is unavailable');
    expect(result.note).toBe('Status unverified for 1 additional service.');
  });

  it('pluralizes the caveat', () => {
    const result = deriveOverallPublicHealth([
      ...repeat('OPERATIONAL', 2),
      ...repeat('UNKNOWN', 3),
    ]);
    expect(result.note).toBe('Status unverified for 3 additional services.');
  });

  it('keeps partial and major impact distinct without claiming the whole page is down', () => {
    expect(deriveOverallPublicHealth(services('PARTIAL_OUTAGE')).headline).toBe(
      'One service has limited availability'
    );
    expect(deriveOverallPublicHealth(services('MAJOR_OUTAGE')).headline).toBe(
      'One service is unavailable'
    );
    expect(
      deriveOverallPublicHealth(services('OPERATIONAL', 'MAJOR_OUTAGE', 'MAJOR_OUTAGE')).headline
    ).toBe('Some services are unavailable');
    expect(deriveOverallPublicHealth(services('MAJOR_OUTAGE', 'MAJOR_OUTAGE')).headline).toBe(
      'All services are unavailable'
    );
  });

  it('never lets unknown services reduce reported severity', () => {
    // The invariant that makes this safe to show a visitor.
    for (const status of PUBLIC_SERVICE_STATUSES) {
      if (status === 'UNKNOWN') continue;
      const alone = deriveOverallPublicHealth(services(status));
      for (const extra of [1, 5, 50]) {
        const padded = deriveOverallPublicHealth([{ status }, ...repeat('UNKNOWN', extra)]);
        expect(padded.status).toBe(alone.status);
      }
    }
  });

  it('never reports operational when no service could be verified', () => {
    for (const count of [1, 2, 10]) {
      expect(deriveOverallPublicHealth(repeat('UNKNOWN', count)).status).not.toBe('OPERATIONAL');
    }
  });

  it('counts known and unknown services separately', () => {
    const result = deriveOverallPublicHealth([
      ...repeat('OPERATIONAL', 3),
      ...repeat('UNKNOWN', 2),
    ]);
    expect(result.knownServiceCount).toBe(3);
    expect(result.unknownServiceCount).toBe(2);
  });
});

describe('worstKnownPublicStatus', () => {
  it('ignores unknown and returns null when nothing is known', () => {
    expect(worstKnownPublicStatus(['UNKNOWN', 'DEGRADED', 'UNKNOWN'])).toBe('DEGRADED');
    expect(worstKnownPublicStatus(['UNKNOWN'])).toBeNull();
    expect(worstKnownPublicStatus([])).toBeNull();
  });

  it('ranks major outage above partial above degraded above maintenance', () => {
    expect(worstKnownPublicStatus(['MAINTENANCE', 'DEGRADED'])).toBe('DEGRADED');
    expect(worstKnownPublicStatus(['DEGRADED', 'PARTIAL_OUTAGE'])).toBe('PARTIAL_OUTAGE');
    expect(worstKnownPublicStatus(['PARTIAL_OUTAGE', 'MAJOR_OUTAGE'])).toBe('MAJOR_OUTAGE');
  });
});
