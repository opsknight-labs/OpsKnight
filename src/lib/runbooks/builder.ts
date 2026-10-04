import type { RunbookDefinition, RunbookStepDefinition, RunbookStepType } from './types';

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
export function canonicalConditionField(field: string): string {
  return ['priority', 'urgency', 'status', 'title', 'description', 'tags'].includes(field)
    ? `incident.${field}`
    : field;
}
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
  if (['SYSTEMD', 'DOCKER'].includes(step.type) && ['start', 'stop'].includes(action))
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
        newBuilderStep('KUBERNETES', 'inspect'),
        {
          ...newBuilderStep('KUBERNETES', 'restart'),
          name: 'Restart deployment',
          riskClass: 'NON_IDEMPOTENT',
          requiresApproval: true,
          config: {
            action: 'rollout-restart',
            namespace: 'default',
            resource: 'deployment',
            name: 'api',
          },
        },
        newBuilderStep('KUBERNETES', 'verify'),
      ],
    };
  return { steps: [newBuilderStep('MANUAL', 'first_step')] };
}
