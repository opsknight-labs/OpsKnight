import { describe, expect, it } from 'vitest';
import {
  builderRisk,
  newBuilderStep,
  RUNBOOK_TEMPLATES,
  runbookTemplate,
  cloneStepRecursively,
} from '@/lib/runbooks/builder';
import { parseRunbookDefinition } from '@/lib/runbooks/definition';

describe('Runbook authoring templates', () => {
  it.each(RUNBOOK_TEMPLATES)('creates a server-valid %s template', template => {
    expect(() => parseRunbookDefinition(runbookTemplate(template))).not.toThrow();
    const writes = runbookTemplate(template).steps.filter(
      step => step.riskClass === 'NON_IDEMPOTENT'
    );
    expect(writes.every(step => step.requiresApproval)).toBe(true);
  });

  it('hardens kubernetes-recovery template with named deployment and rollout-status verification', () => {
    const k8sTemplate = runbookTemplate('kubernetes-recovery');
    expect(k8sTemplate.steps).toHaveLength(3);

    // Step 1: inspect
    expect(k8sTemplate.steps[0].config.resource).toBe('deployment');
    expect(k8sTemplate.steps[0].config.name).toBe('api');
    expect(k8sTemplate.steps[0].config.action).toBe('get');

    // Step 2: rollout restart with nested rollout-status verification
    expect(k8sTemplate.steps[1].config.resource).toBe('deployment');
    expect(k8sTemplate.steps[1].config.name).toBe('api');
    expect(k8sTemplate.steps[1].config.action).toBe('rollout-restart');
    expect(k8sTemplate.steps[1].verification?.steps).toHaveLength(1);
    expect(k8sTemplate.steps[1].verification?.steps[0].config.action).toBe('rollout-status');
    expect(k8sTemplate.steps[1].verification?.steps[0].config.resource).toBe('deployment');
    expect(k8sTemplate.steps[1].verification?.steps[0].config.name).toBe('api');

    // Step 3: verify
    expect(k8sTemplate.steps[2].config.resource).toBe('deployment');
    expect(k8sTemplate.steps[2].config.name).toBe('api');
    expect(k8sTemplate.steps[2].config.action).toBe('get');
  });
  it('derives authoring risk from executable semantics', () => {
    expect(
      builderRisk({
        ...newBuilderStep('SYSTEMD', 'restart'),
        config: { action: 'restart', unit: 'api.service' },
      })
    ).toBe('NON_IDEMPOTENT');
    expect(
      builderRisk({
        ...newBuilderStep('HTTP', 'post'),
        config: { method: 'POST', url: 'https://example.invalid' },
      })
    ).toBe('NON_IDEMPOTENT');
    expect(builderRisk(newBuilderStep('DOCKER', 'inspect'))).toBe('READ_ONLY');
  });
  it('uses the canonical incident priority field for new condition steps', () => {
    expect(newBuilderStep('CONDITION', 'gate').config.field).toBe('incident.priority');
  });

  it('recursively clones a step and regenerates keys for all nested descendants', () => {
    const source = {
      ...newBuilderStep('SYSTEMD', 'restart_svc'),
      name: 'Restart service',
      riskClass: 'NON_IDEMPOTENT' as const,
      requiresApproval: true,
      config: { action: 'restart', unit: 'payments.service' },
      precheck: {
        steps: [
          {
            ...newBuilderStep('SYSTEMD', 'check_exists'),
            name: 'Check exists',
            config: { action: 'status', unit: 'payments.service' },
          },
        ],
      },
      verification: {
        steps: [
          {
            ...newBuilderStep('SYSTEMD', 'check_healthy'),
            name: 'Check healthy',
            config: { action: 'status', unit: 'payments.service' },
          },
        ],
      },
    };

    const existingKeys = new Set(['restart_svc', 'check_exists', 'check_healthy']);
    const cloned = cloneStepRecursively(source, existingKeys);

    expect(cloned.key).not.toBe(source.key);
    expect(cloned.key).toMatch(/^[a-z0-9_-]{1,80}$/);
    expect(cloned.name).toBe('Restart service (Copy)');

    // Precheck key must be freshly generated and distinct
    expect(cloned.precheck?.steps[0].key).not.toBe('check_exists');
    expect(cloned.precheck?.steps[0].key).toMatch(/^[a-z0-9_-]{1,80}$/);
    expect(cloned.precheck?.steps[0].name).toBe('Check exists (Copy)');

    // Verification key must be freshly generated and distinct
    expect(cloned.verification?.steps[0].key).not.toBe('check_healthy');
    expect(cloned.verification?.steps[0].key).toMatch(/^[a-z0-9_-]{1,80}$/);
    expect(cloned.verification?.steps[0].name).toBe('Check healthy (Copy)');

    // All keys must be unique in existingKeys
    expect(existingKeys.size).toBe(6);

    // Full runbook containing original and cloned steps must be server-valid
    const definition = { steps: [source, cloned] };
    expect(() => parseRunbookDefinition(definition)).not.toThrow();
  });

  it('guarantees unique keys at 80-character boundary and handles collisions', () => {
    const maxLenKey = 'a'.repeat(80);
    const existingKeys = new Set<string>([maxLenKey]);

    // First clone
    const source = newBuilderStep('MANUAL', maxLenKey);
    const clone1 = cloneStepRecursively(source, existingKeys);
    expect(clone1.key.length).toBeLessThanOrEqual(80);
    expect(clone1.key).toMatch(/^[a-z0-9_-]{1,80}$/);
    expect(existingKeys.has(clone1.key)).toBe(true);

    // Repeated clones to trigger collisions
    for (let i = 0; i < 15; i++) {
      const clone = cloneStepRecursively(source, existingKeys);
      expect(clone.key.length).toBeLessThanOrEqual(80);
      expect(clone.key).toMatch(/^[a-z0-9_-]{1,80}$/);
    }

    expect(existingKeys.size).toBe(17);
  });

  it('bounds cloned step name to at most 200 characters', () => {
    const maxLenName = 'x'.repeat(200);
    const source = {
      ...newBuilderStep('MANUAL', 'step_max_name'),
      name: maxLenName,
    };
    const cloned = cloneStepRecursively(source, new Set<string>());
    expect(cloned.name.length).toBeLessThanOrEqual(200);
    expect(cloned.name.endsWith(' (Copy)')).toBe(true);
    expect(cloned.name).toBe(`${'x'.repeat(193)} (Copy)`);

    const definition = { steps: [source, cloned] };
    expect(() => parseRunbookDefinition(definition)).not.toThrow();
  });
});


