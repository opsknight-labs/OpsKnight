import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AgentPolicy, ClaimedAttempt } from './types';

const STEP_TYPES = new Set<AgentPolicy['allowedStepTypes'][number]>([
  'LINUX_DIAGNOSTICS',
  'SYSTEMD',
  'DOCKER',
  'KUBERNETES',
  'BASH',
]);

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

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const candidate = value ?? fallback;
  if (
    typeof candidate !== 'number' ||
    !Number.isInteger(candidate) ||
    !Number.isFinite(candidate)
  ) {
    throw new Error('Policy limits must be finite integers.');
  }
  return Math.min(maximum, Math.max(minimum, candidate));
}

export async function loadPolicy(path: string): Promise<{ policy: AgentPolicy; hash: string }> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<AgentPolicy> | null;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Policy must be a JSON object.');
  }
  const allowedStepTypes = stringList(parsed.allowedStepTypes ?? DEFAULT_POLICY.allowedStepTypes);
  if (
    allowedStepTypes.some(type => !STEP_TYPES.has(type as AgentPolicy['allowedStepTypes'][number]))
  ) {
    throw new Error('Policy contains an unsupported step type.');
  }
  if (parsed.allowNonIdempotent !== undefined && typeof parsed.allowNonIdempotent !== 'boolean') {
    throw new Error('allowNonIdempotent must be a boolean.');
  }
  const policy: AgentPolicy = {
    allowedStepTypes: allowedStepTypes as AgentPolicy['allowedStepTypes'],
    allowNonIdempotent: parsed.allowNonIdempotent === true,
    systemdUnits: stringList(parsed.systemdUnits ?? []),
    dockerContainers: stringList(parsed.dockerContainers ?? []),
    kubernetesNamespaces: stringList(parsed.kubernetesNamespaces ?? []),
    bashCommandPatterns: stringList(parsed.bashCommandPatterns ?? []),
    maxRuntimeSeconds: boundedInteger(parsed.maxRuntimeSeconds, 300, 1, 3600),
    maxOutputBytes: boundedInteger(parsed.maxOutputBytes, 1_048_576, 1024, 8_388_608),
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
    // Shell commands are exact-match only. Prefix wildcards are safe for
    // argv-based resource names above, but unsafe for `sh -c` because an
    // otherwise allowed prefix could append a second command.
    if (!policy.bashCommandPatterns.includes(command)) {
      throw new Error('LOCAL_POLICY_DENIED: shell command is not allowlisted.');
    }
  }
}
