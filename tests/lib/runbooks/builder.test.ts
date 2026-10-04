import { describe, expect, it } from 'vitest';
import {
  builderRisk,
  newBuilderStep,
  RUNBOOK_TEMPLATES,
  runbookTemplate,
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
});
