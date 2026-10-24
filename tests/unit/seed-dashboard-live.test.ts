import { describe, expect, it } from 'vitest';
import {
  assertLocalDashboardTarget,
  buildAlphaIncidents,
  parseDashboardSeedArgs,
} from '../../scripts/dev/seed-dashboard-live';

const LOCAL = 'postgresql://u:p@127.0.0.1:55433/opsknight_dashboard?schema=public';

describe('dashboard live fixture seed', () => {
  it('only targets the explicitly allowed loopback database outside production', () => {
    expect(() =>
      assertLocalDashboardTarget({ DATABASE_URL: LOCAL } as NodeJS.ProcessEnv)
    ).not.toThrow();
    expect(() =>
      assertLocalDashboardTarget({
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/opsknight_dashboard',
      } as NodeJS.ProcessEnv)
    ).toThrow(/non-loopback/);
    expect(() =>
      assertLocalDashboardTarget({
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/opsknight',
      } as NodeJS.ProcessEnv)
    ).toThrow(/Refusing to seed database/);
    expect(() =>
      assertLocalDashboardTarget({
        DATABASE_URL: LOCAL,
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv)
    ).toThrow(/production/);
  });

  it('maps scenarios to the documented sizes', () => {
    expect(parseDashboardSeedArgs(['--scenario=empty']).count).toBe(0);
    expect(parseDashboardSeedArgs([]).count).toBe(5);
    expect(parseDashboardSeedArgs(['--scenario=busy']).count).toBe(30);
    expect(parseDashboardSeedArgs(['--scenario=stress']).count).toBe(150);
    expect(parseDashboardSeedArgs(['--scenario=stress', '--count=250']).count).toBe(250);
    expect(() => parseDashboardSeedArgs(['--scenario=stress', '--count=99'])).toThrow();
    expect(() => parseDashboardSeedArgs(['--scenario=chaos'])).toThrow();
  });

  it('produces deterministic, mixed priority/state/ownership incidents', () => {
    const ids = {
      apiServiceId: 'api',
      workerServiceId: 'worker',
      teamId: 'alpha',
      alphaId: 'u1',
      peerId: 'u2',
    };
    const incidents = buildAlphaIncidents(30, Date.parse('2026-10-24T10:00:00Z'), ids);
    expect(new Set(incidents.map(item => item.key)).size).toBe(30);
    expect(new Set(incidents.map(item => item.priority))).toEqual(new Set(['P1', 'P2', 'P3']));
    expect(new Set(incidents.map(item => item.status))).toEqual(new Set(['OPEN', 'ACKNOWLEDGED']));
    expect(incidents.some(item => item.assigneeId === null)).toBe(true);
    expect(incidents.some(item => item.assigneeId === 'u1')).toBe(true);
    const created = incidents.map(item => item.createdAt.getTime());
    expect([...created].sort((a, b) => b - a)).toEqual(created);
  });
});
