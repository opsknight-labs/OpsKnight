import { describe, expect, it } from 'vitest';
import {
  attemptsFromTimeline,
  parseEscalationMessage,
} from '@/lib/escalation/step-attempt-backfill';

describe('parseEscalationMessage', () => {
  it.each([
    ['Escalated to Jane Doe (Level 1)', 0, 'USER', 'NOTIFIED', null],
    [
      'Escalated to TEAM: Database (3 users) (Level 2, after 10 minute delay)',
      1,
      'TEAM',
      'NOTIFIED',
      null,
    ],
    [
      'Escalation step 2 conditions did not match. Skipping to next step.',
      1,
      null,
      'SKIPPED',
      'CONDITIONS_NOT_MATCHED',
    ],
    [
      'Escalation step 1 has invalid target configuration (TEAM with no target ID).',
      0,
      'TEAM',
      'SKIPPED',
      'NO_TARGET',
    ],
    [
      'Escalation step 1 (USER) has an unusable target: Target user no longer exists.',
      0,
      'USER',
      'SKIPPED',
      'TARGET_MISSING',
    ],
    [
      'Escalation step 1 (USER) has an unusable target: Target user is disabled, not an active responder.',
      0,
      'USER',
      'SKIPPED',
      'TARGET_INACTIVE',
    ],
    [
      'Escalation step 3 (SCHEDULE: Primary) resolved to no users. Skipping to next step.',
      2,
      'SCHEDULE',
      'SKIPPED',
      'NO_ONE_ON_CALL',
    ],
    [
      'Escalation step 1 (TEAM: Ops) resolved to no users.',
      0,
      'TEAM',
      'SKIPPED',
      'NO_ELIGIBLE_MEMBERS',
    ],
  ])('%s', (message, stepIndex, targetType, outcome, skipReason) => {
    expect(parseEscalationMessage(message)).toEqual({ stepIndex, targetType, outcome, skipReason });
  });

  it('ignores scheduling notes and anything else', () => {
    expect(
      parseEscalationMessage(
        'Escalation scheduled for [[scheduledAt=2026-01-01T00:00:00.000Z]] (5 minute delay)'
      )
    ).toBeNull();
    expect(parseEscalationMessage('Incident acknowledged')).toBeNull();
  });
});

describe('attemptsFromTimeline', () => {
  it('starts a new cycle when the step number does not go up; the last cycle is the current generation', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 10, minute));
    const attempts = attemptsFromTimeline(
      [
        { message: 'Escalated to A (Level 1)', createdAt: at(0) },
        { message: 'Escalated to B (Level 2)', createdAt: at(10) },
        { message: 'Incident reopened', createdAt: at(20) },
        { message: 'Escalated to A (Level 1)', createdAt: at(30) },
      ],
      4
    );
    expect(attempts.map(a => [a.generation, a.stepIndex, a.at.getUTCMinutes()])).toEqual([
      [3, 0, 0],
      [3, 1, 10],
      [4, 0, 30],
    ]);
  });
});
