import { z } from 'zod/v3';
import { MCP_OPERATION_MAP } from '../catalog';
import { callMcpOperation, type ExecutionContext } from './execution';
import { McpBoundaryError, requireMcp } from './errors';
import { MCP_MAX_OPERATIONS } from './budget';
import { logger } from '@/lib/logger';

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
      .max(MCP_MAX_OPERATIONS),
  })
  .strict();

export async function executeMcpPlan(context: ExecutionContext, input: z.infer<typeof planSchema>) {
  const pending = new Map(input.steps.map(step => [step.id, step]));
  const stepIds = new Set(pending.keys());
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
  const results = new Map<
    string,
    { status: string; result?: unknown; error?: string; hint?: string }
  >();
  while (pending.size) {
    context.budget.check();
    const ready = [...pending.values()]
      .filter(step => step.dependsOn.every(id => results.has(id)))
      .slice(0, 2);
    await Promise.all(
      ready.map(async step => {
        pending.delete(step.id);
        const failed = step.dependsOn.find(id => results.get(id)?.status !== 'completed');
        if (failed) {
          results.set(step.id, {
            status: 'skipped',
            error: 'MCP_DEPENDENCY_FAILED',
            hint: `Step "${failed}" did not complete, so this step did not run.`,
          });
          return;
        }
        try {
          const args = resolveReferences(step.args, step.dependsOn, stepIds, results);
          results.set(step.id, {
            status: 'completed',
            result: await callMcpOperation(context, step.operationId, args),
          });
        } catch (error) {
          // A step failure is reported in the result, so log the unexpected ones here.
          if (!(error instanceof McpBoundaryError) || error.status >= 500)
            logger.error('mcp.tool.unexpected_error', {
              requestId: context.requestId,
              tool: 'execute_plan',
              grantId: context.grantId,
              errorName: error instanceof Error ? error.name : typeof error,
              ...(error instanceof McpBoundaryError ? { code: error.code } : {}),
            });
          // The same correction the step would have carried as a tool call of its own.
          results.set(step.id, {
            status: 'failed',
            error: error instanceof McpBoundaryError ? error.code : 'MCP_UNAVAILABLE',
            ...(error instanceof McpBoundaryError && error.hint ? { hint: error.hint } : {}),
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

const MAX_POINTER_LENGTH = 256;
const MAX_REFERENCE_DEPTH = 16;
const STEP_ID = /^[A-Za-z0-9_-]{1,40}$/;

const referenceError = (hint: string) =>
  new McpBoundaryError('MCP_PLAN_REFERENCE', 400, false, hint);

/**
 * Replaces each `{"$from": "<stepId>", "pointer": "/json/pointer"}` in a step's args with the value
 * at that RFC 6901 pointer in the named dependency's result.data. Values never leave the plan, and
 * the step's args are validated against its operation after substitution like any other call.
 */
function resolveReferences(
  args: Record<string, unknown>,
  dependsOn: readonly string[],
  stepIds: ReadonlySet<string>,
  results: ReadonlyMap<string, { result?: unknown }>
) {
  const walk = (value: unknown, at: string[]): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (at.length > MAX_REFERENCE_DEPTH)
      throw referenceError('Arguments are nested too deeply to look for $from references.');
    if (Array.isArray(value)) return value.map((item, index) => walk(item, [...at, String(index)]));
    const entries = Object.entries(value);
    if (!Object.hasOwn(value, '$from'))
      return Object.fromEntries(entries.map(([key, child]) => [key, walk(child, [...at, key])]));
    const where = `/${at.join('/')}`.slice(0, 120);
    const { $from: from, pointer } = value as { $from: unknown; pointer: unknown };
    if (entries.length !== 2 || typeof from !== 'string' || typeof pointer !== 'string')
      throw referenceError(
        `The reference at ${where} needs exactly two strings: $from and pointer.`
      );
    if (!STEP_ID.test(from) || !stepIds.has(from))
      throw referenceError(
        `The reference at ${where} names no step in this plan; $from must be a step id listed in dependsOn.`
      );
    if (!dependsOn.includes(from))
      throw referenceError(
        `The reference at ${where} names step "${from}", which must also be listed in this step's dependsOn.`
      );
    if (pointer.length > MAX_POINTER_LENGTH || (pointer !== '' && !pointer.startsWith('/')))
      throw referenceError(
        `The pointer at ${where} must be "" or start with "/" and be at most ${MAX_POINTER_LENGTH} characters, for example /data/0/id.`
      );
    let target = (results.get(from)?.result as { data?: unknown } | undefined)?.data;
    for (const token of pointer === '' ? [] : pointer.slice(1).split('/')) {
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
      const found =
        target && typeof target === 'object'
          ? Array.isArray(target)
            ? /^(0|[1-9]\d*)$/.test(key) && Number(key) < target.length
            : Object.hasOwn(target, key)
          : false;
      if (!found)
        throw referenceError(
          `The pointer at ${where} finds nothing in step "${from}"'s result.data; read that step's result shape and point at a value that exists.`
        );
      // eslint-disable-next-line security/detect-object-injection -- own key or in-range index, checked above
      target = (target as Record<string, unknown>)[key];
    }
    if (at[0] === 'path' && typeof target !== 'string' && typeof target !== 'number')
      throw referenceError(
        `The pointer at ${where} finds an object, array or empty value in step "${from}"; a path value must be a string or number, such as /data/0/id.`
      );
    return target;
  };
  return walk(args, []) as Record<string, unknown>;
}
