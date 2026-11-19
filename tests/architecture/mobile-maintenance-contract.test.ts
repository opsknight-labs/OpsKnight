import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = {
  desktopIncidents: readFileSync('src/app/(app)/incidents/page.tsx', 'utf8'),
  mobileIncidents: readFileSync('src/app/(mobile)/m/incidents/page.tsx', 'utf8'),
  mobileServices: readFileSync('src/app/(mobile)/m/services/page.tsx', 'utf8'),
  mobileServiceDetail: readFileSync('src/app/(mobile)/m/services/[id]/page.tsx', 'utf8'),
};
const HELD_RULE = "NOT = { status: 'SUPPRESSED', maintenanceWindowId: { not: null } }";

describe('mobile maintenance parity with desktop', () => {
  it('hides held-by-maintenance incidents from the default list on both surfaces', () => {
    const desktop = source.desktopIncidents;
    const mobile = source.mobileIncidents;
    expect(desktop).toContain(HELD_RULE);
    expect(mobile).toContain(HELD_RULE);
    expect(mobile).toContain("if (filter === 'all' && !status)");
  });

  it('badges services in maintenance with one grouped query', () => {
    expect(source.mobileServices).toContain('findServicesInMaintenance(services.map(s => s.id))');
  });

  it('gates mobile maintenance management on the desktop modify check', () => {
    const detail = source.mobileServiceDetail;
    expect(detail).toContain('await assertCanModifyService(service.id)');
    expect(detail).toContain('canManage={canManageService}');
  });
});
