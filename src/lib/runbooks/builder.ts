import type { RunbookDefinition, RunbookStepDefinition, RunbookStepType } from './types';
import type { RunbookInputInput } from './schemas';
export { canonicalConditionField } from './conditions';

export const RUNBOOK_TEMPLATES = [
  'empty',
  'diagnostics',
  'service-recovery',
  'kubernetes-recovery',
] as const;
export const CONDITION_FIELDS = [
  { value: 'incident.priority', label: 'Incident priority' },
  { value: 'incident.urgency', label: 'Incident urgency' },
  { value: 'incident.status', label: 'Incident status' },
  { value: 'incident.title', label: 'Incident title' },
  { value: 'incident.description', label: 'Incident description' },
  { value: 'incident.tags', label: 'Incident tags' },
  { value: 'service.name', label: 'Service name' },
] as const;
export function newBuilderStep(type: RunbookStepType, key: string): RunbookStepDefinition {
  const config: Record<string, unknown> =
    type === 'HTTP'
      ? { method: 'GET', url: '' }
      : type === 'SYSTEMD'
        ? { action: 'status', unit: 'api.service' }
        : type === 'DOCKER'
          ? { action: 'inspect', container: 'api' }
          : type === 'KUBERNETES'
            ? { action: 'get', namespace: 'default', resource: 'pods' }
            : type === 'LINUX_DIAGNOSTICS'
              ? { diagnostic: 'summary' }
              : type === 'WAIT'
                ? { durationSeconds: 5 }
                : type === 'CONDITION'
                  ? { field: 'incident.priority', operator: 'EQUALS', value: 'P1' }
                  : type === 'BASH'
                    ? { command: '' }
                    : {};
  return {
    key,
    name: type
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/\b[a-z]/g, character => character.toUpperCase()),
    type,
    riskClass: type === 'BASH' ? 'NON_IDEMPOTENT' : 'READ_ONLY',
    config,
  };
}

export function builderRisk(step: RunbookStepDefinition): RunbookStepDefinition['riskClass'] {
  const action = String(step.config.action ?? '');
  if (step.type === 'BASH' || action === 'restart' || action === 'rollout-restart')
    return 'NON_IDEMPOTENT';
  if (step.type === 'HTTP') {
    const method = String(step.config.method ?? 'GET');
    return ['GET', 'HEAD'].includes(method)
      ? 'READ_ONLY'
      : ['PUT', 'DELETE'].includes(method)
        ? 'IDEMPOTENT_WRITE'
        : 'NON_IDEMPOTENT';
  }
  if (
    (['SYSTEMD', 'DOCKER'].includes(step.type) && ['start', 'stop'].includes(action)) ||
    (step.type === 'KUBERNETES' && action === 'scale')
  )
    return 'IDEMPOTENT_WRITE';
  return 'READ_ONLY';
}

export function runbookTemplate(template: (typeof RUNBOOK_TEMPLATES)[number]): RunbookDefinition {
  if (template === 'diagnostics')
    return { steps: [newBuilderStep('LINUX_DIAGNOSTICS', 'diagnostics')] };
  if (template === 'service-recovery')
    return {
      steps: [
        { ...newBuilderStep('LINUX_DIAGNOSTICS', 'before'), name: 'Capture baseline diagnostics' },
        { ...newBuilderStep('SYSTEMD', 'status'), name: 'Inspect service state' },
        {
          ...newBuilderStep('SYSTEMD', 'restart'),
          name: 'Restart service',
          riskClass: 'NON_IDEMPOTENT',
          requiresApproval: true,
          config: { action: 'restart', unit: 'api.service' },
        },
        { ...newBuilderStep('SYSTEMD', 'verify'), name: 'Verify service state' },
        { ...newBuilderStep('LINUX_DIAGNOSTICS', 'after'), name: 'Capture final diagnostics' },
      ],
    };
  if (template === 'kubernetes-recovery')
    return {
      steps: [
        {
          ...newBuilderStep('KUBERNETES', 'inspect'),
          name: 'Inspect deployment status',
          config: {
            action: 'get',
            namespace: '${{ inputs.namespace }}',
            resource: 'deployment',
            name: '${{ inputs.deployment_name }}',
          },
        },
        {
          ...newBuilderStep('KUBERNETES', 'restart'),
          name: 'Restart deployment',
          riskClass: 'NON_IDEMPOTENT',
          requiresApproval: true,
          config: {
            action: 'rollout-restart',
            namespace: '${{ inputs.namespace }}',
            resource: 'deployment',
            name: '${{ inputs.deployment_name }}',
          },
          verification: {
            steps: [
              {
                ...newBuilderStep('KUBERNETES', 'rollout_status'),
                name: 'Verify rollout complete',
                riskClass: 'READ_ONLY',
                config: {
                  action: 'rollout-status',
                  namespace: '${{ inputs.namespace }}',
                  resource: 'deployment',
                  name: '${{ inputs.deployment_name }}',
                },
              },
            ],
          },
        },
        {
          ...newBuilderStep('KUBERNETES', 'verify'),
          name: 'Verify deployment health',
          config: {
            action: 'get',
            namespace: '${{ inputs.namespace }}',
            resource: 'deployment',
            name: '${{ inputs.deployment_name }}',
          },
        },
      ],
    };
  return { steps: [newBuilderStep('MANUAL', 'first_step')] };
}

export function runbookTemplateInputs(
  template: (typeof RUNBOOK_TEMPLATES)[number]
): RunbookInputInput[] {
  if (template === 'kubernetes-recovery') {
    return [
      {
        key: 'namespace',
        label: 'Namespace',
        type: 'STRING',
        required: true,
        defaultValue: 'default',
        description: 'Target Kubernetes namespace',
        sequence: 0,
      },
      {
        key: 'deployment_name',
        label: 'Deployment Name',
        type: 'STRING',
        required: true,
        defaultValue: 'api',
        description: 'Name of the deployment to recover',
        sequence: 1,
      },
    ];
  }
  return [];
}

export function generateUniqueStepKey(baseKey: string, existingKeys: Set<string>): string {
  const clean = baseKey
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 60);
  let candidate = `${clean}_copy`;
  if (candidate.length > 80) {
    candidate = candidate.slice(0, 80);
  }
  let counter = 1;
  while (existingKeys.has(candidate)) {
    const suffix = `_copy_${counter}`;
    const maxPrefixLen = Math.max(1, 80 - suffix.length);
    candidate = `${clean.slice(0, maxPrefixLen)}${suffix}`;
    counter++;
  }
  existingKeys.add(candidate);
  return candidate;
}

export function cloneStepRecursively(
  source: RunbookStepDefinition,
  existingKeys: Set<string>
): RunbookStepDefinition {
  const newKey = generateUniqueStepKey(source.key, existingKeys);
  const copySuffix = ' (Copy)';
  const maxBaseLen = Math.max(1, 200 - copySuffix.length);
  const baseName = (source.name || 'Untitled step').slice(0, maxBaseLen);
  const cloned: RunbookStepDefinition = {
    ...JSON.parse(JSON.stringify(source)),
    key: newKey,
    name: `${baseName}${copySuffix}`,
  };

  if (cloned.precheck?.steps) {
    cloned.precheck.steps = cloned.precheck.steps.map(child =>
      cloneStepRecursively(child, existingKeys)
    );
  }

  if (cloned.verification?.steps) {
    cloned.verification.steps = cloned.verification.steps.map(child =>
      cloneStepRecursively(child, existingKeys)
    );
  }

  return cloned;
}

