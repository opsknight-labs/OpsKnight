import { describe, expect, it } from 'vitest';
import { selectEscalationAssignment } from '@/lib/escalation/assignee-selection';

function input(overrides: Partial<Parameters<typeof selectEscalationAssignment>[0]> = {}) {
  return {
    incidentId: 'inc-1',
    generation: 1,
    stepIndex: 0,
    targetType: 'SCHEDULE' as const,
    targetId: 'sch-1',
    userIds: ['carol', 'alice', 'bob'],
    ...overrides,
  };
}

describe('selectEscalationAssignment', () => {
  it('assigns the resolved user for a USER step', () => {
    expect(
      selectEscalationAssignment(
        input({ targetType: 'USER', targetId: 'alice', userIds: ['alice'] })
      )
    ).toEqual({ type: 'USER', userId: 'alice' });
  });

  it('assigns the team itself for a TEAM step', () => {
    expect(
      selectEscalationAssignment(
        input({ targetType: 'TEAM', targetId: 'team-1', userIds: ['alice', 'bob'] })
      )
    ).toEqual({ type: 'TEAM', teamId: 'team-1' });
  });

  it('never assigns a team that reached no eligible responder', () => {
    expect(
      selectEscalationAssignment(input({ targetType: 'TEAM', targetId: 'team-1', userIds: [] }))
    ).toBeNull();
  });

  it('never assigns when the audience is empty', () => {
    expect(selectEscalationAssignment(input({ userIds: [] }))).toBeNull();
  });

  it('picks one schedule responder deterministically, independent of input order', () => {
    const first = selectEscalationAssignment(input({ userIds: ['carol', 'alice', 'bob'] }));
    const shuffled = selectEscalationAssignment(input({ userIds: ['bob', 'carol', 'alice'] }));

    expect(first).toEqual(shuffled);
    expect(first?.type).toBe('USER');
    expect(['alice', 'bob', 'carol']).toContain(
      first && first.type === 'USER' ? first.userId : null
    );
  });

  it('is stable across repeated calls for the same generation and step', () => {
    const picks = Array.from({ length: 20 }, () => selectEscalationAssignment(input()));
    expect(new Set(picks.map(pick => JSON.stringify(pick))).size).toBe(1);
  });

  it('spreads ownership across responders as steps and generations advance', () => {
    const roster = ['alice', 'bob', 'carol', 'dave', 'erin'];
    const selections = new Set<string>();

    for (let generation = 1; generation <= 6; generation += 1) {
      for (let stepIndex = 0; stepIndex < 4; stepIndex += 1) {
        const pick = selectEscalationAssignment(input({ generation, stepIndex, userIds: roster }));
        if (pick && pick.type === 'USER') selections.add(pick.userId);
      }
    }

    // A single sticky responder would defeat the point of schedule targets.
    expect(selections.size).toBeGreaterThan(1);
    for (const userId of selections) expect(roster).toContain(userId);
  });

  it('only ever selects from the eligible audience', () => {
    for (let stepIndex = 0; stepIndex < 50; stepIndex += 1) {
      const pick = selectEscalationAssignment(input({ stepIndex }));
      expect(pick && pick.type === 'USER' ? pick.userId : null).toBeTruthy();
      expect(['alice', 'bob', 'carol']).toContain(
        pick && pick.type === 'USER' ? pick.userId : null
      );
    }
  });
});
