import { policyCheckSteps, samePolicySnapshot } from './policy-checks';
import 'server-only';
import { MAX_AUTOMATIC_POLICY_TARGETS, POLICY_CERTIFICATION_BATCH_SIZE } from './agent-deployment';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { flattenSteps, parseRunbookDefinition, resolveInputTemplates } from './definition';
import { applyRunbookInputDefaults, validateBindingInputValues } from './bindings';
import { checkExecutionReadiness } from './execution-preview';
import { requiresAgent } from './types';
import { stepRequiresApproval } from './safety';
import { describeBinding } from './presentation/binding-contract';
export type BindingReadiness = {
  state: 'PAUSED' | 'BLOCKED' | 'CHECKS_REQUIRED' | 'CONFIGURATION_VALID' | 'UNKNOWN';
  checkedAt: string;
  eligibleAgents: number | null;
  armed: boolean;
  checks: Array<{ code: string; state: 'passed' | 'blocked' | 'deferred'; message: string }>;
};
type Binding = Prisma.ServiceAutomationRuleGetPayload<{
  include: {
    runbook: { include: { publishedVersion: { include: { inputs: true } } } };
    runbookVersion: { include: { inputs: true } };
    triggers: { include: { conditions: true } };
  };
}>;
export async function getBindingReadiness(
  binding: Binding,
  now = new Date(),
  db: Prisma.TransactionClient = prisma
): Promise<BindingReadiness> {
  const checks: BindingReadiness['checks'] = [];
  const presentation = describeBinding(binding, [], []);
  const result = (
    state: BindingReadiness['state'],
    eligibleAgents: number | null = null
  ): BindingReadiness => ({
    state,
    checkedAt: now.toISOString(),
    eligibleAgents,
    armed: presentation.armed,
    checks,
  });
  if (!binding.enabled) return result('PAUSED');
  if (binding.mode !== 'MANUAL' && !presentation.armed)
    checks.push({
      code: 'NO_TRIGGER',
      state: 'blocked',
      message: 'No active incident-created trigger. This rule is not armed.',
    });
  if (binding.mode === 'AUTOMATIC' && binding.versionStrategy !== 'PINNED')
    checks.push({
      code: 'VERSION_NOT_PINNED',
      state: 'blocked',
      message: 'Automatic rules require an immutable pinned version.',
    });
  const version =
    binding.versionStrategy === 'PINNED'
      ? binding.runbookVersion
      : binding.runbook.publishedVersion;
  if (!version || binding.runbook.archivedAt || !['PUBLISHED', 'RETIRED'].includes(version.state)) {
    checks.push({
      code: 'VERSION_UNAVAILABLE',
      state: 'blocked',
      message: 'The selected immutable version is unavailable or archived.',
    });
    return result('BLOCKED');
  }
  try {
    const definition = parseRunbookDefinition(version.definition, version.inputs);
    const values = applyRunbookInputDefaults(
      version.inputs,
      binding.inputValues as Record<string, unknown>
    );
    validateBindingInputValues(version.inputs, values);
    const steps = flattenSteps(definition);
    const agentSteps = steps.filter(step => requiresAgent(step.type));
    let eligibleAgents = 0;
    let candidatePolicies = new Map<string, string | null>();
    let selectedAgentId = binding.defaultAgentId;
    if (agentSteps.length) {
      const rawSelector =
        binding.agentSelector &&
        typeof binding.agentSelector === 'object' &&
        !Array.isArray(binding.agentSelector)
          ? Object.entries(binding.agentSelector)
          : [];
      if (binding.mode === 'AUTOMATIC' && rawSelector.length && !binding.defaultAgentId) {
        checks.push({
          code: 'AUTOMATIC_DYNAMIC_TARGET_UNSUPPORTED',
          state: 'blocked',
          message:
            'Automatic rules require a specific Agent or a fixed pool without a label selector. Use Suggested mode for dynamic targets.',
        });
        return result('BLOCKED');
      }
      if (
        rawSelector.some(
          ([, value]) => typeof value === 'string' && value.includes('incident.labels.')
        )
      ) {
        checks.push({
          code: 'INCIDENT_CONTEXT_REQUIRED',
          state: 'deferred',
          message:
            'This selector is resolved from a future incident. Preview from that incident to check its exact target and policy.',
        });
        return result(
          checks.some(check => check.state === 'blocked') ? 'BLOCKED' : 'CHECKS_REQUIRED',
          null
        );
      }
      const selector = rawSelector.map(
        ([key, value]) => [key, resolveInputTemplates(value, values)] as const
      );
      if (!binding.defaultAgentId && !binding.defaultAgentPoolId && !selector.length) {
        checks.push({
          code: 'TARGET_MISSING',
          state: 'blocked',
          message: 'Agent actions require a specific Agent, pool or explicit selector.',
        });
        return result('BLOCKED');
      }
      const candidates = await db.runbookAgent.findMany({
        where: {
          status: 'ONLINE',
          lastHeartbeatAt: { gte: new Date(now.getTime() - 90_000) },
          ...(binding.defaultAgentId ? { id: binding.defaultAgentId } : {}),
          ...(binding.defaultAgentPoolId
            ? { poolMemberships: { some: { poolId: binding.defaultAgentPoolId } } }
            : {}),
          ...(selector.length
            ? {
                AND: selector.map(([key, value]) => ({
                  labels: { path: [key], equals: value as Prisma.InputJsonValue },
                })),
              }
            : {}),
        },
        select: { id: true, policyHash: true },
        take: 501,
      });
      eligibleAgents = candidates.length;
      candidatePolicies = new Map(candidates.map(agent => [agent.id, agent.policyHash]));
      if (!eligibleAgents)
        checks.push({
          code: 'AGENT_OFFLINE',
          state: 'blocked',
          message: 'No fresh online Agent matches this target and selector.',
        });
      if (eligibleAgents > 500)
        checks.push({
          code: 'TARGET_TOO_BROAD',
          state: 'blocked',
          message: 'Target exceeds the bounded readiness check. Narrow the selector.',
        });
      if (binding.mode === 'AUTOMATIC' && eligibleAgents > MAX_AUTOMATIC_POLICY_TARGETS)
        checks.push({
          code: 'AUTOMATIC_POLICY_TARGET_LIMIT',
          state: 'blocked',
          message: `Automatic activation supports at most ${MAX_AUTOMATIC_POLICY_TARGETS} online Agents per target. Narrow the fixed pool or use Suggested mode.`,
        });
      const pool = binding.defaultAgentPoolId
        ? await db.runbookAgentPool.findUnique({
            where: { id: binding.defaultAgentPoolId },
            select: { mode: true },
          })
        : null;
      if (
        pool?.mode === 'LOCAL_HOSTS' &&
        eligibleAgents !== 1 &&
        agentSteps.some(step => step.riskClass !== 'READ_ONLY')
      )
        checks.push({
          code: 'TARGET_AMBIGUOUS',
          state: 'blocked',
          message: 'Machine-specific writes require exactly one eligible Agent.',
        });
      if (!selectedAgentId && selector.length && candidates.length === 1)
        selectedAgentId = candidates[0].id;
      // Dynamic multi-Agent selectors need per-Agent plan checks; do not claim them verified via an unfiltered fleet query.
      if (!selector.length || selectedAgentId) {
        const readiness = await checkExecutionReadiness(db, {
          steps,
          inputValues: values,
          agentId: selectedAgentId,
          agentPoolId: binding.defaultAgentPoolId,
        });
        checks.push(
          ...readiness.map((check, index) => ({ ...check, code: `TARGET_CHECK_${index}` }))
        );
      } else
        checks.push({
          code: 'DYNAMIC_POLICY_CHECK',
          state: 'deferred',
          message:
            'Dynamic dispatch must check each selected Agent capability, policy, secret grant and confidential transport.',
        });
    }
    if (steps.some(stepRequiresApproval))
      checks.push({
        code: 'APPROVAL_REQUIRED',
        state: 'deferred',
        message: 'One or more steps require approval of the frozen execution plan.',
      });
    const policyChecks: Prisma.RunbookPolicyCheckGetPayload<object>[] = [];
    const candidateIds = [...candidatePolicies.keys()];
    // Read the newest evidence for each actual eligible Agent. A busy Agent's
    // history must not crowd another Agent out of a global take-N query.
    for (
      let offset = 0;
      offset < Math.min(candidateIds.length, MAX_AUTOMATIC_POLICY_TARGETS);
      offset += POLICY_CERTIFICATION_BATCH_SIZE
    ) {
      const batch = await Promise.all(
        candidateIds.slice(offset, offset + POLICY_CERTIFICATION_BATCH_SIZE).map(agentId =>
          db.runbookPolicyCheck.findFirst({
            where: {
              ruleId: binding.id,
              agentId,
              versionId: version.id,
              checksum: version.checksum,
              checkedAt: { gte: new Date(now.getTime() - 5 * 60_000) },
            },
            orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
          })
        )
      );
      for (const check of batch) if (check) policyChecks.push(check);
    }
    const seen = new Set<string>();
    for (const policyCheck of policyChecks) {
      if (
        seen.has(policyCheck.agentId) ||
        !candidatePolicies.has(policyCheck.agentId) ||
        candidatePolicies.get(policyCheck.agentId) !== policyCheck.policyHash ||
        !samePolicySnapshot(policyCheck.steps, policyCheckSteps(steps, values))
      )
        continue;
      seen.add(policyCheck.agentId);
      checks.push({
        code: `AGENT_POLICY_${policyCheck.agentId}`,
        state:
          policyCheck.status === 'PASSED'
            ? 'passed'
            : policyCheck.status === 'DEFERRED'
              ? 'deferred'
              : 'blocked',
        message: `${policyCheck.status === 'PASSED' ? 'Agent local policy accepted the frozen configuration' : policyCheck.status === 'DEFERRED' ? 'Agent policy cannot verify secret-dependent fields before execution' : 'Agent local policy denied one or more actions'} at ${policyCheck.checkedAt?.toISOString()}. This evidence does not grant target permissions and does not execute steps.`,
      });
    }
    const blocked = checks.some(check => check.state === 'blocked');
    return result(
      blocked
        ? 'BLOCKED'
        : checks.some(check => check.state === 'deferred')
          ? 'CHECKS_REQUIRED'
          : 'CONFIGURATION_VALID',
      eligibleAgents
    );
  } catch {
    checks.push({
      code: 'CHECK_UNAVAILABLE',
      state: 'blocked',
      message:
        'Definition, inputs or target checks could not be completed. Review configuration or retry after dependencies recover.',
    });
    return result('UNKNOWN');
  }
}
