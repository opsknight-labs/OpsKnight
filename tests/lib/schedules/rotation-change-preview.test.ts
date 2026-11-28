import { describe, expect, it } from 'vitest';
import type { LayerInput, OverrideInput } from '@/lib/oncall';
import {
  previewScheduleChange,
  summarizeRotationChange,
  type PreviewSchedule,
} from '@/lib/schedules/rotation-change-preview';

const NOW = new Date('2026-12-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const member = (userId: string, name: string, position: number) => ({
  userId,
  position,
  user: { name },
});

const layer: LayerInput = {
  id: 'layer-1',
  name: 'Primary',
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: null,
  rotationLengthHours: 24,
  priority: 0,
  users: [
    member('u-ann', 'Ann', 0),
    member('u-ben', 'Ben', 1),
    member('u-cy', 'Cy', 2),
    member('u-dee', 'Dee', 3),
  ],
};

const schedule = (overrides: OverrideInput[] = []): PreviewSchedule => ({
  id: 'sched-1',
  name: 'Platform on-call',
  timeZone: 'UTC',
  layers: [layer],
  overrides,
});

describe('previewScheduleChange', () => {
  it('lists the shifts that move when a member leaves a 4-person rotation', () => {
    const changes = previewScheduleChange(
      schedule(),
      { layerId: 'layer-1', userIds: ['u-ben'] },
      NOW
    );
    // Daily slots go mod 4 -> mod 3, so most of the next four weeks change owner.
    expect(changes.length).toBeGreaterThan(10);
    for (const change of changes) {
      expect(change.before.map(person => person.id)).not.toEqual(
        change.after.map(person => person.id)
      );
    }
    expect(changes.every(change => change.after[0]?.id !== 'u-ben')).toBe(true);
  });

  it('reports nothing when the leaving user is not in the rotation', () => {
    expect(
      previewScheduleChange(schedule(), { layerId: 'layer-1', userIds: ['u-nobody'] }, NOW)
    ).toEqual([]);
  });

  it('stops the deactivated user own overrides, but not when only leaving a layer', () => {
    const override: OverrideInput = {
      id: 'ov-1',
      userId: 'u-eve',
      user: { name: 'Eve' },
      start: new Date(NOW.getTime() + 2 * DAY),
      end: new Date(NOW.getTime() + 3 * DAY),
      replacesUserId: null,
    };
    const deactivated = previewScheduleChange(schedule([override]), { userIds: ['u-eve'] }, NOW);
    // An override without a replaced person is additive: Eve is on call beside the rotation owner.
    expect(deactivated.length).toBeGreaterThan(0);
    for (const change of deactivated) {
      expect(change.before.map(person => person.id)).toContain('u-eve');
      expect(change.after.map(person => person.id)).not.toContain('u-eve');
    }
    expect(
      previewScheduleChange(schedule([override]), { layerId: 'layer-1', userIds: ['u-eve'] }, NOW)
    ).toEqual([]);
  });
});

describe('summarizeRotationChange', () => {
  it('names before and after for the changed shifts', () => {
    const subject = schedule();
    const removal = { layerId: 'layer-1', userIds: ['u-ben'] };
    const summary = summarizeRotationChange(
      [{ schedule: subject, changes: previewScheduleChange(subject, removal, NOW) }],
      NOW
    );
    expect(summary.changed).toBe(true);
    expect(summary.message).toContain('Platform on-call (UTC)');
    expect(summary.message).toMatch(/Ann becomes|Ben becomes|Cy becomes|Dee becomes/);
  });

  it('says nothing changes when no shift moves, so no prompt is needed', () => {
    expect(summarizeRotationChange([{ schedule: schedule(), changes: [] }], NOW)).toEqual({
      changed: false,
      message: '',
    });
  });
});
