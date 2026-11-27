import { describe, expect, it } from 'vitest';
import { wallboardCycleDefault } from '@/components/dashboard/live/LiveWallboard';

const params = (query: string) => new URLSearchParams(query);

describe('wallboardCycleDefault', () => {
  it('cycles views on a plain wallboard URL', () => {
    expect(wallboardCycleDefault(params(''))).toBe(true);
    expect(wallboardCycleDefault(params('lteam=team-1'))).toBe(true);
  });

  it('keeps the view the URL names instead of cycling away from it', () => {
    expect(wallboardCycleDefault(params('lview=unassigned'))).toBe(false);
  });

  it('keeps honouring ?cycle=off', () => {
    expect(wallboardCycleDefault(params('cycle=off'))).toBe(false);
  });
});
