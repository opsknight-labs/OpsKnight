import { describe, expect, it } from 'vitest';
import { planEscalationStep, type EscalationPlanInput } from '@/lib/escalation/planner';

const NOW = new Date('2026-05-01T10:00:00.000Z');

function planInput(overrides: Partial<EscalationPlanInput> = {}): EscalationPlanInput {
  return {
    incidentId: 'inc-1',
    generation: 2,
    stepIndex: 0,
    stepCount: 3,
    targetType: 'USER',
    targetId: 'user-1',
    resolution: { outcome: 'RESOLVED', userIds: ['user-1'], targetName: 'Alice' },
    stepDelayMinutes: 0,
    nextStepDelayMinutes: 10,
    now: NOW,
    ...overrides,
  };
}

describe('a step that reaches responders', () => {
  it('pages, takes ownership, and arms the next step in one plan', () => {
    const plan = planEscalationStep(planInput());

    expect(plan.outcome).toBe('STEP_EXECUTED');
    expect(plan.notificationRecipients).toEqual(['user-1']);
    expect(plan.assignment).toEqual({ type: 'USER', userId: 'user-1' });
    expect(plan.nextState).toEqual({
      status: 'ESCALATING',
      currentStep: 1,
      nextEscalationAt: new Date('2026-05-01T10:10:00.000Z'),
    });
    expect(plan.nextJob).toEqual({
      stepIndex: 1,
      scheduledAt: new Date('2026-05-01T10:10:00.000Z'),
    });
  });

  it('always pairs a next state with the job that will run it', () => {
    const plan = planEscalationStep(planInput({ nextStepDelayMinutes: 0 }));

    expect(plan.nextJob?.scheduledAt).toEqual(plan.nextState.nextEscalationAt);
    expect(plan.nextJob?.stepIndex).toBe(plan.nextState.currentStep);
  });

  it('completes — never loops — after the final step', () => {
    const plan = planEscalationStep(
      planInput({ stepIndex: 2, stepCount: 3, nextStepDelayMinutes: null })
    );

    expect(plan.outcome).toBe('STEP_EXECUTED');
    expect(plan.nextState).toEqual({
      status: 'COMPLETED',
      currentStep: null,
      nextEscalationAt: null,
    });
    expect(plan.nextJob).toBeNull();
    expect(plan.timelineEvents.map(event => event.message).join(' ')).not.toMatch(/loop/i);
  });

  it('records the step in the timeline with its level and delay', () => {
    const plan = planEscalationStep(planInput({ stepIndex: 1, stepDelayMinutes: 15 }));

    expect(plan.timelineEvents[0]).toEqual({
      type: 'ESCALATED',
      message: 'Escalated to Alice (Level 2, after 15 minute delay)',
    });
  });

  it('describes a multi-responder target by its size', () => {
    const plan = planEscalationStep(
      planInput({
        targetType: 'SCHEDULE',
        targetId: 'sch-1',
        resolution: {
          outcome: 'RESOLVED',
          userIds: ['alice', 'bob'],
          targetName: 'Primary On-Call',
        },
      })
    );

    expect(plan.timelineEvents[0].message).toBe(
      'Escalated to SCHEDULE: Primary On-Call (2 users) (Level 1)'
    );
  });

  it('pages a hand-assigned owner alongside the target without giving them ownership', () => {
    const plan = planEscalationStep(
      planInput({
        resolution: { outcome: 'RESOLVED', userIds: ['user-1'], targetName: 'Alice' },
        extraRecipients: ['manual-owner'],
      })
    );

    expect(plan.notificationRecipients).toEqual(['user-1', 'manual-owner']);
    // Ownership follows the policy's target, not an incidental extra recipient.
    expect(plan.assignment).toEqual({ type: 'USER', userId: 'user-1' });
  });

  it('never lets an extra recipient make an uncovered target look successful', () => {
    // A final tier reporting COMPLETED because a hand-assigned owner happened
    // to be in the audience would mean nobody the policy pointed at was paged.
    const plan = planEscalationStep(
      planInput({
        stepIndex: 2,
        stepCount: 3,
        nextStepDelayMinutes: null,
        resolution: { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Primary On-Call' },
        extraRecipients: ['manual-owner'],
      })
    );

    expect(plan.outcome).toBe('NO_ELIGIBLE_RESPONDERS');
    expect(plan.notificationRecipients).toEqual([]);
    expect(plan.assignment).toBeNull();
    expect(plan.nextState.status).toBe('FAILED');
  });

  it('skips an uncovered intermediate tier even with an extra recipient present', () => {
    const plan = planEscalationStep(
      planInput({
        resolution: { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Primary On-Call' },
        extraRecipients: ['manual-owner'],
      })
    );

    expect(plan.outcome).toBe('STEP_SCHEDULED');
    expect(plan.notificationRecipients).toEqual([]);
  });

  it('does not page the same responder twice', () => {
    const plan = planEscalationStep(
      planInput({
        resolution: { outcome: 'RESOLVED', userIds: ['user-1'], targetName: 'Alice' },
        extraRecipients: ['user-1'],
      })
    );

    expect(plan.notificationRecipients).toEqual(['user-1']);
  });
});

describe('a step that reaches nobody', () => {
  const unreachable: Array<[string, Partial<EscalationPlanInput>, string]> = [
    ['a step with no target ID', { targetId: null }, 'INVALID_TARGET'],
    [
      'a step whose target is unusable',
      { resolution: { outcome: 'INVALID_TARGET', reason: 'Target user is disabled' } },
      'INVALID_TARGET',
    ],
    [
      'a target with no eligible responders',
      { resolution: { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Primary On-Call' } },
      'NO_ELIGIBLE_RESPONDERS',
    ],
  ];

  it.each(unreachable)('skips to the next tier for %s', (_label, overrides) => {
    const plan = planEscalationStep(planInput({ ...overrides, stepIndex: 0, stepCount: 3 }));

    expect(plan.outcome).toBe('STEP_SCHEDULED');
    expect(plan.notificationRecipients).toEqual([]);
    expect(plan.assignment).toBeNull();
    expect(plan.nextState).toEqual({
      status: 'ESCALATING',
      currentStep: 1,
      nextEscalationAt: NOW,
    });
    // A skipped tier stays discoverable by the reconciliation scanner.
    expect(plan.nextJob).toEqual({ stepIndex: 1, scheduledAt: NOW });
    expect(plan.timelineEvents[0].message).toMatch(/Skipping to next step\.$/);
  });

  it.each(unreachable)(
    'fails the execution for %s on the final step',
    (_label, overrides, outcome) => {
      const plan = planEscalationStep(
        planInput({ ...overrides, stepIndex: 2, stepCount: 3, nextStepDelayMinutes: null })
      );

      expect(plan.outcome).toBe(outcome);
      expect(plan.nextState).toEqual({
        status: 'FAILED',
        currentStep: null,
        nextEscalationAt: null,
      });
      expect(plan.nextJob).toBeNull();
      expect(plan.assignment).toBeNull();
    }
  );

  it('explains an unusable target in the timeline', () => {
    const plan = planEscalationStep(
      planInput({
        stepIndex: 2,
        stepCount: 3,
        resolution: { outcome: 'INVALID_TARGET', reason: 'Target user no longer exists' },
      })
    );

    expect(plan.timelineEvents[0].message).toBe(
      'Escalation step 3 (USER) has an unusable target: Target user no longer exists. Escalation failed: target is unavailable.'
    );
  });

  it('distinguishes an uncovered target from an unusable one in the timeline', () => {
    const plan = planEscalationStep(
      planInput({
        stepIndex: 2,
        stepCount: 3,
        targetType: 'SCHEDULE',
        targetId: 'sch-1',
        resolution: { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Primary On-Call' },
      })
    );

    expect(plan.timelineEvents[0].message).toBe(
      'Escalation step 3 (SCHEDULE: Primary On-Call) resolved to no users. Escalation failed: no reachable responders.'
    );
  });
});

describe('plan invariants', () => {
  const everyBranch: Array<Partial<EscalationPlanInput>> = [
    {},
    { stepIndex: 2, stepCount: 3, nextStepDelayMinutes: null },
    { targetId: null },
    { resolution: { outcome: 'INVALID_TARGET', reason: 'gone' } },
    { resolution: { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Nobody' } },
    {
      stepIndex: 2,
      stepCount: 3,
      nextStepDelayMinutes: null,
      resolution: { outcome: 'NO_ELIGIBLE_RESPONDERS', targetName: 'Nobody' },
    },
    { stepCount: 1, nextStepDelayMinutes: null },
    { targetType: 'TEAM', targetId: 'team-1' },
  ];

  it.each(everyBranch.map((overrides, index) => [index, overrides] as const))(
    'branch %i returns a complete, self-consistent plan',
    (_index, overrides) => {
      const plan = planEscalationStep(planInput(overrides));

      // A next job exists exactly when the execution stays armed.
      if (plan.nextJob) {
        expect(plan.nextState.status).toBe('ESCALATING');
        expect(plan.nextState.currentStep).toBe(plan.nextJob.stepIndex);
        expect(plan.nextState.nextEscalationAt).toEqual(plan.nextJob.scheduledAt);
      } else {
        expect(plan.nextState.nextEscalationAt).toBeNull();
        expect(plan.nextState.currentStep).toBeNull();
        expect(['COMPLETED', 'FAILED']).toContain(plan.nextState.status);
      }

      // Nobody paged means nobody owns it.
      if (plan.notificationRecipients.length === 0) expect(plan.assignment).toBeNull();
      expect(plan.timelineEvents.length).toBeGreaterThan(0);
    }
  );
});
