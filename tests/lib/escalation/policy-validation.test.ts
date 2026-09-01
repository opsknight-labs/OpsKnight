import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ESCALATION_DELAY_MINUTES,
  escalationStepOrdersAreContiguous,
  escalationTargetExists,
  firstEscalationStepIssue,
  parseEscalationDelayMinutes,
  validateEscalationStep,
} from '@/lib/escalation/policy-validation';

function issueFields(input: Parameters<typeof validateEscalationStep>[0]): string[] {
  const result = validateEscalationStep(input);
  return result.valid ? [] : result.issues.map(issue => issue.field);
}

describe('parseEscalationDelayMinutes', () => {
  it('accepts whole minutes within bounds', () => {
    expect(parseEscalationDelayMinutes('15')).toBe(15);
    expect(parseEscalationDelayMinutes(0)).toBe(0);
    expect(parseEscalationDelayMinutes(MAX_ESCALATION_DELAY_MINUTES)).toBe(
      MAX_ESCALATION_DELAY_MINUTES
    );
  });

  it('treats a missing delay as immediate', () => {
    expect(parseEscalationDelayMinutes(undefined)).toBe(0);
    expect(parseEscalationDelayMinutes(null)).toBe(0);
    expect(parseEscalationDelayMinutes('')).toBe(0);
  });

  it.each([
    ['unparseable text', 'later'],
    ['a fraction of a minute', '1.5'],
    ['a negative delay', '-5'],
    ['past the cap', String(MAX_ESCALATION_DELAY_MINUTES + 1)],
    ['infinity', Number.POSITIVE_INFINITY],
    ['not a number', Number.NaN],
  ])('rejects %s', (_label, raw) => {
    // parseInt('later') is NaN, and a NaN delay reaches the database as a step
    // that can never come due.
    expect(parseEscalationDelayMinutes(raw)).toBeNull();
  });
});

describe('validateEscalationStep', () => {
  it('normalizes a valid USER step to exactly one target id', () => {
    const result = validateEscalationStep({
      targetType: 'USER',
      targetUserId: '  user-1  ',
      targetTeamId: 'team-should-be-dropped',
      delayMinutes: '10',
      notificationChannels: ['SMS', 'EMAIL', 'SMS'],
      notifyOnlyTeamLead: true,
    });

    expect(result).toEqual({
      valid: true,
      step: {
        targetType: 'USER',
        targetUserId: 'user-1',
        targetTeamId: null,
        targetScheduleId: null,
        delayMinutes: 10,
        // Duplicates collapsed, order preserved.
        notificationChannels: ['SMS', 'EMAIL'],
        // Lead-only is a team concept and is dropped for other targets.
        notifyOnlyTeamLead: false,
      },
    });
  });

  it('keeps lead-only for a TEAM step', () => {
    const result = validateEscalationStep({
      targetType: 'TEAM',
      targetTeamId: 'team-1',
      notifyOnlyTeamLead: true,
    });

    expect(result).toMatchObject({ valid: true, step: { notifyOnlyTeamLead: true } });
  });

  it('defaults channels to recipient preferences when none are chosen', () => {
    const result = validateEscalationStep({ targetType: 'SCHEDULE', targetScheduleId: 'sch-1' });

    expect(result).toMatchObject({ valid: true, step: { notificationChannels: [] } });
  });

  it('rejects an unknown target type', () => {
    expect(issueFields({ targetType: 'WEBHOOK', targetUserId: 'user-1' })).toEqual(['targetType']);
  });

  it.each([
    ['USER', 'targetUserId'],
    ['TEAM', 'targetTeamId'],
    ['SCHEDULE', 'targetScheduleId'],
  ])('requires the %s step to carry its own target id', (targetType, field) => {
    expect(issueFields({ targetType })).toEqual([field]);
  });

  it('rejects a step whose target id belongs to a different target type', () => {
    // A TEAM step carrying only a user id is exactly the shape that reaches an
    // incident as "invalid target configuration" months later.
    expect(issueFields({ targetType: 'TEAM', targetUserId: 'user-1' })).toEqual(['targetTeamId']);
  });

  it('treats a blank target id as missing', () => {
    expect(issueFields({ targetType: 'USER', targetUserId: '   ' })).toEqual(['targetUserId']);
  });

  it('rejects an out-of-range delay', () => {
    expect(issueFields({ targetType: 'USER', targetUserId: 'user-1', delayMinutes: '-1' })).toEqual(
      ['delayMinutes']
    );
  });

  it('rejects a channel the system cannot deliver on', () => {
    expect(
      issueFields({
        targetType: 'USER',
        targetUserId: 'user-1',
        notificationChannels: ['CARRIER_PIGEON'],
      })
    ).toEqual(['notificationChannels']);
  });

  it('reports every problem at once', () => {
    expect(
      issueFields({ targetType: 'USER', delayMinutes: 'soon', notificationChannels: ['FAX'] })
    ).toEqual(['delayMinutes', 'targetUserId', 'notificationChannels']);
  });

  it('always has something to say to the operator', () => {
    expect(firstEscalationStepIssue([])).toMatch(/not valid/);
    expect(firstEscalationStepIssue([{ field: 'delayMinutes', message: 'Too long.' }])).toBe(
      'Too long.'
    );
  });
});

describe('escalationStepOrdersAreContiguous', () => {
  it.each([
    [[], true],
    [[0], true],
    [[0, 1, 2], true],
    [[2, 0, 1], true],
    [[0, 2], false],
    [[1, 2], false],
    [[0, 0, 1], false],
  ])('%j -> %s', (orders, expected) => {
    expect(escalationStepOrdersAreContiguous(orders as number[])).toBe(expected);
  });
});

describe('escalationTargetExists', () => {
  it.each(['USER', 'TEAM', 'SCHEDULE'] as const)(
    'checks only the table that owns a %s target',
    async targetType => {
      const tx = {
        user: { count: vi.fn().mockResolvedValue(targetType === 'USER' ? 1 : 0) },
        team: { count: vi.fn().mockResolvedValue(targetType === 'TEAM' ? 1 : 0) },
        onCallSchedule: { count: vi.fn().mockResolvedValue(targetType === 'SCHEDULE' ? 1 : 0) },
      };

      await expect(escalationTargetExists(tx as never, targetType, 'target-1')).resolves.toBe(true);

      const owning =
        targetType === 'USER' ? tx.user : targetType === 'TEAM' ? tx.team : tx.onCallSchedule;
      expect(owning.count).toHaveBeenCalledWith({
        where: targetType === 'USER' ? { id: 'target-1', status: 'ACTIVE' } : { id: 'target-1' },
      });
      const others = [tx.user, tx.team, tx.onCallSchedule].filter(model => model !== owning);
      for (const model of others) expect(model.count).not.toHaveBeenCalled();
    }
  );

  it('reports a missing target', async () => {
    const tx = { user: { count: vi.fn().mockResolvedValue(0) } };

    await expect(escalationTargetExists(tx as never, 'USER', 'gone')).resolves.toBe(false);
  });
});
