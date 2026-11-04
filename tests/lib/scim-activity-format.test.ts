import { describe, expect, it } from 'vitest';
import { describeScimEvent } from '@/lib/scim/activity-format';

describe('SCIM activity in plain language', () => {
  it('flags offboarding that leaves on-call coverage gaps', () => {
    expect(
      describeScimEvent(
        'user.disabled',
        {
          operationalImpact: {
            teamCount: 2,
            futureShifts: 3,
            directEscalationRules: 1,
            teamsWithoutActiveResponders: 1,
          },
        },
        'Priya Shah'
      )
    ).toEqual({
      label: 'Person deactivated',
      detail:
        'Priya Shah. Review coverage: 3 upcoming on-call shifts need a new owner, 1 escalation rule pages them directly, 1 team now has no active responder.',
      attention: true,
    });
  });

  it('stays calm when nothing needs attention, and never shows raw JSON', () => {
    const quiet = describeScimEvent(
      'user.disabled',
      { operationalImpact: { teamCount: 1, futureShifts: 0 } },
      'Sam Lee'
    );
    expect(quiet).toMatchObject({ attention: false });
    expect(quiet.detail).toBe('Sam Lee. Still listed on 1 team; no on-call gaps.');
    expect(describeScimEvent('group.created', { members: 3 }, null).detail).not.toContain('{');
    expect(describeScimEvent('binding.approved', {}, null).label).toBe('Group linked to a team');
  });

  it('keeps the resource and simple details for events without a tailored sentence', () => {
    expect(
      describeScimEvent(
        'group.updated',
        { displayName: 'Platform on-call', added: ['u1', 'u2'], nested: { a: 1 } },
        null,
        'grp-42'
      ).detail
    ).toBe('grp-42 · displayName: Platform on-call · added: 2 items');
    expect(
      describeScimEvent('request.rejected', { error: 'x'.repeat(200) }, null, null).detail
    ).toHaveLength('error: '.length + 81);
  });
});
