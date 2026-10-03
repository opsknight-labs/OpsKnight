import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AgentPolicy, ClaimedAttempt } from './types';

export const DEFAULT_POLICY: AgentPolicy = {
  allowedStepTypes: ['LINUX_DIAGNOSTICS'],
  allowNonIdempotent: false,
  systemdUnits: [],
  dockerContainers: [],
  kubernetesNamespaces: [],
  bashCommandPatterns: [],
  maxRuntimeSeconds: 300,
  maxOutputBytes: 1_048_576,
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('Policy allowlists must be arrays of strings.');
  }
  return value;
}

export async function loadPolicy(path: string): Promise<{ policy: AgentPolicy; hash: string }> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<AgentPolicy>;
  const policy: AgentPolicy = {
    allowedStepTypes: stringList(
      parsed.allowedStepTypes ?? DEFAULT_POLICY.allowedStepTypes
    ) as AgentPolicy['allowedStepTypes'],
    allowNonIdempotent: parsed.allowNonIdempotent === true,
    systemdUnits: stringList(parsed.systemdUnits ?? []),
    dockerContainers: stringList(parsed.dockerContainers ?? []),
    kubernetesNamespaces: stringList(parsed.kubernetesNamespaces ?? []),
    bashCommandPatterns: stringList(parsed.bashCommandPatterns ?? []),
    maxRuntimeSeconds: Math.min(3600, Math.max(1, parsed.maxRuntimeSeconds ?? 300)),
    maxOutputBytes: Math.min(8_388_608, Math.max(1024, parsed.maxOutputBytes ?? 1_048_576)),
  };
  return { policy, hash: createHash('sha256').update(raw).digest('hex') };
}

function matchesAllowlist(value: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
    return value === pattern;
  });
}

export function assertPolicyAllows(attempt: ClaimedAttempt, policy: AgentPolicy): void {
  const { step } = attempt;
  if (!policy.allowedStepTypes.includes(step.type)) {
    throw new Error(`LOCAL_POLICY_DENIED: ${step.type} is not enabled on this Agent.`);
  }
  if (step.riskClass === 'NON_IDEMPOTENT' && !policy.allowNonIdempotent) {
    throw new Error('LOCAL_POLICY_DENIED: non-idempotent actions are disabled.');
  }
  const config = step.config;
  if (step.type === 'SYSTEMD') {
    const unit = String(config.unit ?? '');
    if (!matchesAllowlist(unit, policy.systemdUnits)) {
      throw new Error(`LOCAL_POLICY_DENIED: systemd unit ${unit || '<empty>'} is not allowlisted.`);
    }
  }
  if (step.type === 'DOCKER') {
    const container = String(config.container ?? '');
    if (!matchesAllowlist(container, policy.dockerContainers)) {
      throw new Error(
        `LOCAL_POLICY_DENIED: Docker container ${container || '<empty>'} is not allowlisted.`
      );
    }
  }
  if (step.type === 'KUBERNETES') {
    const namespace = String(config.namespace ?? 'default');
    if (!matchesAllowlist(namespace, policy.kubernetesNamespaces)) {
      throw new Error(`LOCAL_POLICY_DENIED: namespace ${namespace} is not allowlisted.`);
    }
  }
  if (step.type === 'BASH') {
    const command = String(config.command ?? '');
    if (!matchesAllowlist(command, policy.bashCommandPatterns)) {
      throw new Error('LOCAL_POLICY_DENIED: shell command is not allowlisted.');
    }
  }
}
