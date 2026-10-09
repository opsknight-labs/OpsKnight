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
  linuxDiagnostics: ['summary', 'disk', 'memory'],
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
  // Only the operator's local startup configuration supplies this path, never a claim.
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
  if (
    parsed.networkPorts !== undefined &&
    (!Array.isArray(parsed.networkPorts) ||
      parsed.networkPorts.some(port => !Number.isInteger(port) || port < 1 || port > 65535))
  )
    throw new Error('Network ports must be integers between 1 and 65535.');
  const policy: AgentPolicy = {
    allowedStepTypes: allowedStepTypes as AgentPolicy['allowedStepTypes'],
    allowNonIdempotent: parsed.allowNonIdempotent === true,
    systemdUnits: stringList(parsed.systemdUnits ?? []),
    dockerContainers: stringList(parsed.dockerContainers ?? []),
    kubernetesNamespaces: stringList(parsed.kubernetesNamespaces ?? []),
    bashCommandPatterns: stringList(parsed.bashCommandPatterns ?? []),
    maxRuntimeSeconds: boundedInteger(parsed.maxRuntimeSeconds, 300, 1, 3600),
    maxOutputBytes: boundedInteger(parsed.maxOutputBytes, 1_048_576, 1024, 8_388_608),
    podmanContainers: stringList(parsed.podmanContainers ?? []),
    kubernetesActions: stringList(
      parsed.kubernetesActions ?? ['get', 'describe', 'logs', 'rollout-restart']
    ),
    kubernetesMaxReplicas: boundedInteger(parsed.kubernetesMaxReplicas, 0, 0, 10000),
    kubernetesTargets: Array.isArray(parsed.kubernetesTargets)
      ? parsed.kubernetesTargets.map((target: unknown) => {
          if (!target || typeof target !== 'object' || Array.isArray(target)) {
            throw new Error('kubernetesTargets entries must be objects.');
          }
          const t = target as Record<string, unknown>;
          if (typeof t.namespace !== 'string') {
            throw new Error('kubernetesTargets entries must specify a namespace string.');
          }
          return {
            namespace: t.namespace,
            resources: t.resources !== undefined ? stringList(t.resources) : undefined,
            names: t.names !== undefined ? stringList(t.names) : undefined,
            actions: t.actions !== undefined ? stringList(t.actions) : undefined,
            maxReplicas:
              t.maxReplicas !== undefined
                ? boundedInteger(t.maxReplicas, 0, 0, 10000)
                : undefined,
          };
        })
      : undefined,
    linuxDiagnostics: stringList(parsed.linuxDiagnostics ?? ['summary', 'disk', 'memory']),
    networkHosts: stringList(parsed.networkHosts ?? []),
    networkPorts:
      Array.isArray(parsed.networkPorts) &&
      parsed.networkPorts.every(port => Number.isInteger(port) && port >= 1 && port <= 65535)
        ? parsed.networkPorts
        : [],
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
  for (const name of step.type === 'SYSTEMD'
    ? ['unit']
    : step.type === 'DOCKER'
      ? ['container']
      : step.type === 'KUBERNETES'
        ? ['namespace', 'resource', 'name']
        : []) {
    const value = Object.entries(config).find(([key]) => key === name)?.[1];
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.startsWith('-') || !/^[a-zA-Z0-9_.@:-]+$/.test(value))
    )
      throw new Error('LOCAL_POLICY_DENIED: invalid executable target.');
  }
  if (step.type === 'SYSTEMD') {
    const unit = String(config.unit ?? '');
    if (!matchesAllowlist(unit, policy.systemdUnits)) {
      throw new Error(`LOCAL_POLICY_DENIED: systemd unit ${unit || '<empty>'} is not allowlisted.`);
    }
  }
  if (step.type === 'DOCKER') {
    const container = String(config.container ?? '');
    if (
      !matchesAllowlist(
        container,
        config.runtime === 'podman' ? (policy.podmanContainers ?? []) : policy.dockerContainers
      )
    ) {
      throw new Error(
        `LOCAL_POLICY_DENIED: Docker container ${container || '<empty>'} is not allowlisted.`
      );
    }
  }
  if (step.type === 'KUBERNETES') {
    const action = String(config.action ?? 'get');
    const namespace = String(config.namespace ?? 'default');
    const resource = String(config.resource ?? 'pods').toLowerCase();
    const name = String(config.name ?? '');

    if (policy.kubernetesTargets && policy.kubernetesTargets.length > 0) {
      const matchingTarget = policy.kubernetesTargets.find(target => {
        if (!matchesAllowlist(namespace, [target.namespace])) return false;
        if (
          target.resources &&
          !matchesAllowlist(resource, target.resources.map(r => r.toLowerCase()))
        ) {
          return false;
        }
        if (target.names && target.names.length > 0) {
          if (!name || !matchesAllowlist(name, target.names)) {
            return false;
          }
        }
        if (target.actions && !target.actions.includes(action)) {
          return false;
        }
        if (action === 'scale') {
          const maxReplicas = target.maxReplicas ?? policy.kubernetesMaxReplicas ?? 0;
          if (
            maxReplicas <= 0 ||
            !Number.isInteger(config.replicas) ||
            Number(config.replicas) < 0 ||
            Number(config.replicas) > maxReplicas
          ) {
            return false;
          }
        }
        return true;
      });
      if (!matchingTarget) {
        throw new Error(
          `LOCAL_POLICY_DENIED: Kubernetes target (${action} ${resource}/${name || '*'} in ${namespace}) is not allowlisted by local agent target policies.`
        );
      }
    } else {
      if (
        !(policy.kubernetesActions ?? ['get', 'describe', 'logs', 'rollout-restart']).includes(action)
      )
        throw new Error('LOCAL_POLICY_DENIED: Kubernetes action is not allowlisted.');
      if (
        action === 'scale' &&
        (!Number.isInteger(config.replicas) ||
          Number(config.replicas) < 0 ||
          Number(config.replicas) > (policy.kubernetesMaxReplicas ?? 0))
      )
        throw new Error('LOCAL_POLICY_DENIED: Kubernetes replica limit exceeded.');
      if (!matchesAllowlist(namespace, policy.kubernetesNamespaces)) {
        throw new Error(`LOCAL_POLICY_DENIED: namespace ${namespace} is not allowlisted.`);
      }
    }
  }
  if (step.type === 'LINUX_DIAGNOSTICS') {
    const diagnostic = String(config.diagnostic ?? 'summary');
    const allowed = policy.linuxDiagnostics ?? ['summary', 'disk', 'memory'];
    if (!allowed.includes(diagnostic)) {
      throw new Error(`LOCAL_POLICY_DENIED: Linux diagnostic ${diagnostic} is not allowlisted.`);
    }
  }
  if (
    step.type === 'LINUX_DIAGNOSTICS' &&
    ['dns', 'tcp', 'http'].includes(String(config.diagnostic))
  ) {
    const url = config.diagnostic === 'http' ? new URL(String(config.url)) : null;
    const host = url?.hostname ?? String(config.hostname ?? config.host ?? '');
    const port = url
      ? Number(url.port || (url.protocol === 'https:' ? 443 : 80))
      : Number(config.port ?? 53);
    if (url && (!['http:', 'https:'].includes(url.protocol) || url.username || url.password))
      throw new Error('LOCAL_POLICY_DENIED: invalid diagnostic URL.');
    if (!(policy.networkHosts ?? []).includes(host) || !(policy.networkPorts ?? []).includes(port))
      throw new Error('LOCAL_POLICY_DENIED: diagnostic network destination is not allowlisted.');
  }
  if (
    step.type === 'LINUX_DIAGNOSTICS' &&
    config.diagnostic === 'journal' &&
    !matchesAllowlist(String(config.unit), policy.systemdUnits)
  )
    throw new Error('LOCAL_POLICY_DENIED: journal unit is not allowlisted.');
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
