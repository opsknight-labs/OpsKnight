import { afterEach, describe, expect, it, vi } from 'vitest';
import { CostBudget } from '@/lib/mcp/core/budget';
import { McpBoundaryError } from '@/lib/mcp/core/errors';

const execution = vi.hoisted(() => ({ callMcpOperation: vi.fn() }));
vi.mock('@/lib/mcp/core/execution', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/mcp/core/execution')>()),
  callMcpOperation: execution.callMcpOperation,
}));
const { executeMcpPlan, planSchema } = await import('@/lib/mcp/core/plan');

afterEach(() => execution.callMcpOperation.mockReset());

const context = () => ({ grantId: 'g', tokenScopes: [], requestId: 'r', budget: new CostBudget() });
const list = { evidence: {}, data: { data: [{ id: 'svc_1', tags: ['a'] }, { id: 'svc_2' }] } };
const run = (steps: unknown[]) => executeMcpPlan(context(), planSchema.parse({ steps }));
const first = { id: 'services', operationId: 'listServices', args: { query: {} } };

describe('execute_plan references between steps', () => {
  it('replaces {$from, pointer} anywhere in args with the value from a dependency', async () => {
    execution.callMcpOperation.mockImplementation(async (_c, operationId) =>
      operationId === 'listServices' ? list : { evidence: {}, data: { ok: true } }
    );
    const plan = await run([
      first,
      {
        id: 'service',
        operationId: 'getService',
        dependsOn: ['services'],
        args: {
          path: { id: { $from: 'services', pointer: '/data/0/id' } },
          query: { nested: [{ tag: { $from: 'services', pointer: '/data/0/tags/0' } }] },
        },
      },
    ]);
    expect(plan.steps.map(step => step.status)).toEqual(['completed', 'completed']);
    expect(execution.callMcpOperation).toHaveBeenLastCalledWith(expect.anything(), 'getService', {
      path: { id: 'svc_1' },
      query: { nested: [{ tag: 'a' }] },
    });
  });

  it('decodes ~1 and ~0 in pointers (RFC 6901)', async () => {
    execution.callMcpOperation.mockResolvedValueOnce({
      evidence: {},
      data: { 'a/b': { 'c~d': 'x' } },
    });
    execution.callMcpOperation.mockResolvedValueOnce({ evidence: {}, data: {} });
    await run([
      first,
      {
        id: 'b',
        operationId: 'getService',
        dependsOn: ['services'],
        args: { path: { id: { $from: 'services', pointer: '/a~1b/c~0d' } } },
      },
    ]);
    expect(execution.callMcpOperation).toHaveBeenLastCalledWith(expect.anything(), 'getService', {
      path: { id: 'x' },
    });
  });

  const failing: [string, Record<string, unknown>, RegExp][] = [
    ['an unknown step', { $from: 'nope', pointer: '/data/0/id' }, /no step in this plan/],
    ['a step not in dependsOn', { $from: 'other', pointer: '/data/0/id' }, /must also be listed/],
    ['a missing pointer target', { $from: 'services', pointer: '/data/9/id' }, /finds nothing/],
    ['a non-scalar path value', { $from: 'services', pointer: '/data/0' }, /string or number/],
    ['a pointer without a leading slash', { $from: 'services', pointer: 'data' }, /pointer/],
    ['an over-long pointer', { $from: 'services', pointer: `/${'a'.repeat(300)}` }, /pointer/],
    ['an extra key', { $from: 'services', pointer: '/data', also: 1 }, /exactly/],
  ];
  it.each(failing)('fails only the referring step for %s', async (_name, ref, hint) => {
    execution.callMcpOperation.mockResolvedValue(list);
    const plan = await run([
      first,
      { id: 'other', operationId: 'listTeams', args: {} },
      {
        id: 'service',
        operationId: 'getService',
        dependsOn: ['services'],
        args: { path: { id: ref } },
      },
      { id: 'after', operationId: 'listTeams', args: {}, dependsOn: ['services'] },
    ]);
    const service = plan.steps.find(step => step.id === 'service')!;
    expect(service).toMatchObject({ status: 'failed', error: 'MCP_PLAN_REFERENCE' });
    expect(service.hint).toMatch(hint);
    expect(plan.steps.find(step => step.id === 'after')?.status).toBe('completed');
    expect(execution.callMcpOperation).not.toHaveBeenCalledWith(
      expect.anything(),
      'getService',
      expect.anything()
    );
  });

  it('skips a step whose referenced dependency failed, naming that step', async () => {
    execution.callMcpOperation.mockRejectedValueOnce(
      new McpBoundaryError('MCP_OPERATION_FORBIDDEN', 403)
    );
    const plan = await run([
      first,
      {
        id: 'service',
        operationId: 'getService',
        dependsOn: ['services'],
        args: { path: { id: { $from: 'services', pointer: '/data/0/id' } } },
      },
    ]);
    expect(plan.steps[1]).toMatchObject({ status: 'skipped', error: 'MCP_DEPENDENCY_FAILED' });
    expect(plan.steps[1].hint).toMatch(/"services"/);
  });

  it('bounds how deep it looks for references', async () => {
    execution.callMcpOperation.mockResolvedValue(list);
    let deep: unknown = { $from: 'services', pointer: '/data/0/id' };
    for (let level = 0; level < 20; level++) deep = { next: deep };
    const plan = await run([
      first,
      { id: 'deep', operationId: 'listTeams', dependsOn: ['services'], args: { query: deep } },
    ]);
    expect(plan.steps[1]).toMatchObject({ status: 'failed', error: 'MCP_PLAN_REFERENCE' });
    expect(plan.steps[1].hint).toMatch(/nested/);
  });
});
