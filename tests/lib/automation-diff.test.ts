import { expect, it } from 'vitest';
import { compareSnapshots } from '@/lib/automation/diff';
import { emptySnapshot, type Rule } from '@/lib/automation/contract';
it('reports additions, changes, removals, and rule order changes for review', () => {
  const rule: Rule = {
    id: 'a',
    name: 'First',
    phase: 'ROUTE',
    enabled: true,
    conditions: [],
    actions: [{ type: 'USE_SERVICE_DEFAULT' }],
  };
  const second = { ...rule, id: 'b', name: 'Second' };
  expect(
    compareSnapshots(
      { ...emptySnapshot, rules: [rule, second] },
      { ...emptySnapshot, rules: [second, { ...rule, name: 'Renamed' }] }
    )
  ).toEqual(['Rule changed: Renamed', 'Rule order changed']);
  expect(compareSnapshots(emptySnapshot, { ...emptySnapshot, rules: [rule] })).toContain(
    'Rule added: First'
  );
  expect(compareSnapshots({ ...emptySnapshot, rules: [rule] }, emptySnapshot)).toContain(
    'Rule removed: First'
  );
});
