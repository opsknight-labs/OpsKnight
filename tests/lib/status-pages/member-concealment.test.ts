import { describe, expect, it } from 'vitest';
import { concealHiddenGroupMembers } from '@/lib/status-pages/member-concealment';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';

const svc = (id: string, regions: string[] = []) => ({
  id,
  name: `Svc ${id}`,
  status: 'MAJOR_OUTAGE',
  regions,
});
const group = (id: string, memberServiceIds: string[], showMembers?: false) => ({
  id,
  name: `Group ${id}`,
  status: 'MAJOR_OUTAGE',
  memberServiceIds,
  ...(showMembers === false ? { showMembers } : {}),
  activeIncidentCount: 1,
  impactedServiceCount: memberServiceIds.length,
});

function snapshot(): PublicStatusPageSnapshot {
  return {
    services: [svc('secret', ['eu']), svc('shared', ['eu']), svc('open')],
    businessServices: [group('hidden', ['secret', 'shared'], false), group('visible', ['shared'])],
    regions: [],
    incidents: [
      {
        status: 'OPEN',
        service: { id: 'secret', name: 'Svc secret' },
        businessServices: [{ id: 'hidden', name: 'Group hidden' }],
      },
      { status: 'OPEN', service: { id: 'open', name: 'Svc open' } },
    ],
    maintenance: [
      {
        id: 'm',
        title: 'M',
        state: 'SCHEDULED',
        startAt: 'x',
        affectedServices: [{ id: 'secret', name: 'Svc secret' }],
      },
    ],
    announcements: [
      {
        id: 'a',
        title: 'A',
        message: '',
        type: 'INFO',
        startDate: 'x',
        endDate: null,
        affectedServices: [
          { id: 'secret', name: 'S' },
          { id: 'open', name: 'O' },
        ],
      },
    ],
  } as unknown as PublicStatusPageSnapshot;
}

describe('concealHiddenGroupMembers', () => {
  it('removes members of a showMembers=false group from every public field', () => {
    const out = concealHiddenGroupMembers(snapshot());
    expect(out.services.map(s => s.id)).toEqual(['shared', 'open']);
    expect(out.businessServices?.find(g => g.id === 'hidden')?.memberServiceIds).toEqual([]);
    expect(out.businessServices?.find(g => g.id === 'visible')?.memberServiceIds).toEqual([
      'shared',
    ]);
    expect(out.incidents[0].service).toBeUndefined();
    expect(out.incidents[0].businessServices).toEqual([{ id: 'hidden', name: 'Group hidden' }]);
    expect(out.incidents[1].service?.id).toBe('open');
    expect(out.maintenance?.[0].affectedServices).toBeUndefined();
    expect(out.announcements?.[0].affectedServices).toEqual([{ id: 'open', name: 'O' }]);
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('keeps a service the admin published directly, even inside a hidden group', () => {
    const out = concealHiddenGroupMembers(snapshot(), new Set(['secret']));
    expect(out.services.map(s => s.id)).toContain('secret');
    expect(out.incidents[0].service?.id).toBe('secret');
    expect(out.businessServices?.find(g => g.id === 'hidden')?.memberServiceIds).toContain(
      'secret'
    );
  });

  it('is a no-op when every group lists its members', () => {
    const input = snapshot();
    input.businessServices = [group('visible', ['shared'])] as never;
    expect(concealHiddenGroupMembers(input)).toBe(input);
  });
});
