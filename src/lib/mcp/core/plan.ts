import { z } from 'zod';
import { MCP_OPERATION_MAP } from '../catalog';
import { callMcpOperation, type ExecutionContext } from './execution';
import { McpBoundaryError, requireMcp } from './errors';

export const planSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
            operationId: z.string().max(128),
            args: z.record(z.string(), z.unknown()),
            dependsOn: z.array(z.string().max(40)).max(8).default([]),
          })
          .strict()
      )
      .min(1)
      .max(8),
  })
  .strict();

export async function executeMcpPlan(context: ExecutionContext, input: z.infer<typeof planSchema>) {
  const pending = new Map(input.steps.map(step => [step.id, step]));
  requireMcp(pending.size === input.steps.length, 'MCP_DUPLICATE_STEP');
  requireMcp(input.steps.length <= context.budget.maxOperations, 'MCP_OPERATION_BUDGET_EXCEEDED');
  for (const step of input.steps) {
    requireMcp(MCP_OPERATION_MAP.get(step.operationId)?.risk === 'R0', 'MCP_PLAN_READS_ONLY');
    requireMcp(
      step.dependsOn.every(id => pending.has(id) && id !== step.id),
      'MCP_INVALID_DEPENDENCY'
    );
  }
  // Validate acyclicity before doing any work.
  const visited = new Set<string>();
  for (let depth = 0; depth < 8; depth++) {
    for (const step of input.steps)
      if (step.dependsOn.every(id => visited.has(id))) visited.add(step.id);
  }
  requireMcp(visited.size === pending.size, 'MCP_CYCLIC_PLAN');
  const results = new Map<string, { status: string; result?: unknown; error?: string }>();
  while (pending.size) {
    context.budget.check();
    const ready = [...pending.values()]
      .filter(step => step.dependsOn.every(id => results.has(id)))
      .slice(0, 2);
    await Promise.all(
      ready.map(async step => {
        pending.delete(step.id);
        if (step.dependsOn.some(id => results.get(id)?.status !== 'completed')) {
          results.set(step.id, { status: 'skipped', error: 'MCP_DEPENDENCY_FAILED' });
          return;
        }
        try {
          results.set(step.id, {
            status: 'completed',
            result: await callMcpOperation(context, step.operationId, step.args),
          });
        } catch (error) {
          results.set(step.id, {
            status: 'failed',
            error: error instanceof McpBoundaryError ? error.code : 'MCP_UNAVAILABLE',
          });
        }
      })
    );
  }
  return {
    steps: input.steps.map(step => ({ id: step.id, ...results.get(step.id) })),
    atomic: false,
  };
}
