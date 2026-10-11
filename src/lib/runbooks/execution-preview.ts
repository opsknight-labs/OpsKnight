import 'server-only';
import crypto from 'crypto';
import { sortJsonValue, resolveInputTemplates, isSecretReference } from './shared-definition';
import { stepRequiresApproval } from './safety';
import { redactRunbookOutput } from './redaction';
import { DEFAULT_STEP_TIMEOUT_SECONDS, requiresAgent, type RunbookStepDefinition } from './types';

export interface ExecutionPreview {
  digest: string;
  authorizationToken?: string;
  expiresAt?: string;
  readiness?: { state: 'passed' | 'blocked' | 'deferred'; message: string }[];
  versionId: string;
  version: number;
  checksum: string;
  agentId: string | null;
  agentPoolId: string | null;
  timeoutSeconds: number;
  inputs: Record<string, unknown>;
  steps: {
    key: string;
    name: string;
    type: string;
    risk: string;
    purpose: string;
    requiresApproval: boolean;
    timeoutSeconds: number;
    config: unknown;
    prerequisite: string;
  }[];
}

export function buildExecutionPreview(plan: {
  authorizationContext?: unknown;
  runbookId: string;
  versionId: string;
  version: number;
  checksum: string;
  agentId: string | null;
  agentPoolId: string | null;
  selectedLabels: Record<string, string>;
  sourceAgentPoolId?: string | null;
  timeoutSeconds: number;
  inputValues: Record<string, unknown>;
  inputTypes: ReadonlyArray<{ key: string; type: string }>;
  steps: RunbookStepDefinition[];
}): ExecutionPreview {
  const purposes = new Map<string, string>();
  const markChecks = (step: RunbookStepDefinition) => {
    for (const check of step.precheck?.steps ?? []) {
      purposes.set(check.key, `Before ${step.key}: prerequisite check must pass.`);
      markChecks(check);
    }
    for (const check of step.verification?.steps ?? []) {
      purposes.set(
        check.key,
        `After ${step.key}: verification must pass to confirm the authored outcome.`
      );
      markChecks(check);
    }
  };
  plan.steps.forEach(markChecks);
  const steps = plan.steps.map(step => ({
    key: step.key,
    name: String(resolveInputTemplates(step.name, plan.inputValues)),
    type: step.type,
    risk: step.riskClass,
    purpose: purposes.get(step.key) ?? 'Workflow action',
    requiresApproval: stepRequiresApproval(step),
    timeoutSeconds: step.timeoutSeconds ?? DEFAULT_STEP_TIMEOUT_SECONDS,
    config: resolveInputTemplates(step.config, plan.inputValues),
    prerequisite: requiresAgent(step.type)
      ? 'Agent capability, local policy and secret grants checked again at dispatch.'
      : 'Control-plane execution; live network and permission checks apply.',
  }));
  // Includes target selection and values, not just the definition checksum.
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(sortJsonValue({ ...plan, steps })))
    .digest('hex');
  const secretKeys = new Set(
    plan.inputTypes.filter(input => input.type === 'SECRET_REF').map(input => input.key)
  );
  const redact = (value: unknown, key = ''): unknown => {
    if (
      secretKeys.has(key) ||
      /secret|password|token|authorization|credential|api.?key/i.test(key) ||
      isSecretReference(value)
    )
      return '[REDACTED]';
    if (typeof value === 'string')
      return redactRunbookOutput(value.replace(/secret:\/\/[a-z0-9-]+/g, '[REDACTED]'));
    if (Array.isArray(value)) return value.map(item => redact(item));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([name, nested]) => [name, redact(nested, name)])
      );
    return value;
  };
  return {
    digest,
    versionId: plan.versionId,
    version: plan.version,
    checksum: plan.checksum,
    agentId: plan.agentId,
    agentPoolId: plan.agentPoolId,
    timeoutSeconds: plan.timeoutSeconds,
    inputs: redact(plan.inputValues) as Record<string, unknown>,
    steps: steps.map(step => ({
      ...step,
      name: String(redact(step.name)),
      config: redact(step.config),
    })),
  };
}

export async function checkExecutionReadiness(
  tx: import('@prisma/client').Prisma.TransactionClient,
  plan: {
    steps: RunbookStepDefinition[];
    inputValues: Record<string, unknown>;
    agentId: string | null;
    agentPoolId: string | null;
  }
): Promise<{ state: 'passed' | 'blocked' | 'deferred'; message: string }[]> {
  const agentSteps = plan.steps.filter(step => requiresAgent(step.type));
  const checks: { state: 'passed' | 'blocked' | 'deferred'; message: string }[] = [];
  if (agentSteps.length) {
    const agents = await tx.runbookAgent.findMany({
      where: {
        ...(plan.agentId ? { id: plan.agentId } : {}),
        ...(plan.agentPoolId ? { poolMemberships: { some: { poolId: plan.agentPoolId } } } : {}),
        status: 'ONLINE',
        lastHeartbeatAt: { gte: new Date(Date.now() - 90000) },
      },
      select: { id: true, capabilities: true },
    });
    const { agentSupportsStep } = await import('./safety');
    const eligibleSteps = agentSteps.map(step => ({
      step,
      agents: agents.filter(agent => {
        if (!Array.isArray(agent.capabilities)) return false;
        const capabilities = agent.capabilities as string[];
        const runtime = (
          resolveInputTemplates(step.config, plan.inputValues) as Record<string, unknown>
        ).runtime;
        return (
          agentSupportsStep(capabilities, step.type) &&
          (step.type !== 'DOCKER' ||
            (runtime === 'podman'
              ? capabilities.includes('RUNBOOK_PODMAN')
              : !capabilities.includes('RUNBOOK_PODMAN') ||
                capabilities.includes('RUNBOOK_DOCKER_RUNTIME')))
        );
      }),
    }));
    const capable = eligibleSteps.every(entry => entry.agents.length > 0);
    checks.push({
      state: capable ? 'passed' : 'blocked',
      message: capable
        ? 'Each planned action has a healthy capable Agent for this target.'
        : 'No healthy capable Agent is available for this target.',
    });
    const { collectSecretReferences, referencedStepInputKeys } =
      await import('./shared-definition');
    const stepSecrets = eligibleSteps.map(entry => {
      const referenced = referencedStepInputKeys(entry.step.config, entry.step.type, false);
      return {
        agents: entry.agents,
        secrets: [
          ...collectSecretReferences(
            Object.fromEntries(
              Object.entries(plan.inputValues).filter(([key]) => referenced.has(key))
            )
          ),
        ],
      };
    });
    const secrets = [...new Set(stepSecrets.flatMap(entry => entry.secrets))];
    if (secrets.length) {
      const records = await tx.runbookSecret.findMany({
        where: { name: { in: secrets } },
        select: { name: true, grants: { select: { agentId: true, agentPoolId: true } } },
      });
      const granted = stepSecrets.every(
        entry =>
          entry.secrets.length === 0 ||
          entry.agents.some(agent =>
            entry.secrets.every(name =>
              records.some(
                record =>
                  record.name === name &&
                  record.grants.some(
                    grant =>
                      grant.agentId === agent.id ||
                      Boolean(plan.agentPoolId && grant.agentPoolId === plan.agentPoolId)
                  )
              )
            )
          )
      );
      checks.push({
        state: granted ? 'passed' : 'blocked',
        message: granted
          ? 'Required secret references currently have grants for an eligible target.'
          : 'A required secret is unavailable or has no eligible target grant.',
      });
    }
  }
  checks.push({
    state: 'deferred',
    message:
      'Local Agent policy, confidential transport, live network access and platform permissions are enforced at dispatch.',
  });
  return checks;
}
