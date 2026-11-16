import { describe, expect, it } from 'vitest';
import { listTools, loadTasks, validateTasks } from '../../scripts/mcp/eval';

/** The tool-selection eval dataset must keep naming tools and operations that exist. */
describe('tool-selection eval dataset', () => {
  it('is valid against the current tool list, and the validator catches drift', async () => {
    const tools = {
      responder: await listTools('responder'),
      team_lead: await listTools('team_lead'),
      admin: await listTools('admin'),
    };
    const tasks = loadTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(30);
    expect(validateTasks(tasks, tools)).toEqual([]);

    const [first] = tasks;
    const broken = [
      first,
      { ...first, expected: ['incident_teleport'] },
      { ...first, id: 'x2', expected: ['operation_prepare'], operationId: 'listIncidents' },
      { ...first, id: 'x3', expected: ['incident_search'], operationId: 'setTeamLead' },
    ];
    const problems = validateTasks(broken, tools);
    expect(problems.join('\n')).toMatch(/duplicate id/);
    expect(problems.join('\n')).toMatch(/incident_teleport is not offered/);
    expect(problems.join('\n')).toMatch(/listIncidents is not an approval-gated operation/);
    expect(problems.join('\n')).toMatch(/operationId goes with operation_prepare/);
  });
});
