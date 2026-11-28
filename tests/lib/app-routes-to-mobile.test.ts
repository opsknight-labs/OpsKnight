import { describe, expect, it } from 'vitest';
import { toMobilePath } from '@/lib/app-routes';

describe('toMobilePath', () => {
  it('maps lists, records and the deeper pages the mobile app has', () => {
    expect(toMobilePath('/services')).toBe('/m/services');
    expect(toMobilePath('/services/svc-1')).toBe('/m/services/svc-1');
    expect(toMobilePath('/services/svc-1/automation')).toBe('/m/services/svc-1/automation');
    expect(toMobilePath('/incidents/create')).toBe('/m/incidents/create');
  });

  it('keeps desktop-only pages on desktop instead of a mobile 404', () => {
    expect(toMobilePath('/services/svc-1/integrations')).toBeNull();
    expect(toMobilePath('/services/svc-1/settings')).toBeNull();
    expect(toMobilePath('/incidents/templates')).toBeNull();
    expect(toMobilePath('/incidents/templates/create')).toBeNull();
    expect(toMobilePath('/policies/create')).toBeNull();
    expect(toMobilePath('/postmortems/create')).toBeNull();
    expect(toMobilePath('/services/business')).toBeNull();
    expect(toMobilePath('/services/business/bs-1')).toBeNull();
    expect(toMobilePath('/settings/intelligence')).toBeNull();
  });
});
