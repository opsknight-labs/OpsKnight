import { describe, expect, it } from 'vitest';
import { resolvedApprovalPlan } from '@/lib/runbooks/approval-plan';
import { formatDiagnosticEvidence } from '@/lib/runbooks/presentation/diagnostics';

const opaque = 'unrecognizable-value-9f61"\\line\nend';
describe('Runbook review input privacy', () => {
  it.each([
    ['BASH', { command: 'printf %s "${{ inputs.innocuous }}"' }],
    [
      'HTTP',
      {
        method: 'GET',
        url: 'https://example.test/${{ inputs.innocuous }}?q=${{ inputs.innocuous }}',
        headers: { 'X-Custom': '${{ inputs.innocuous }}' },
      },
    ],
    ['DOCKER', { action: 'inspect', container: '${{ inputs.innocuous }}' }],
    ['SYSTEMD', { action: 'status', unit: '${{ inputs.innocuous }}' }],
    [
      'KUBERNETES',
      {
        action: 'get',
        namespace: '${{ inputs.innocuous }}',
        resource: 'pods',
        name: '${{ inputs.innocuous }}',
      },
    ],
  ])('withholds arbitrary substituted values from %s plans', (type, config) => {
    const result = resolvedApprovalPlan(type, config, { innocuous: opaque });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('unrecognizable-value');
    expect(serialized).not.toContain(encodeURIComponent(opaque));
    expect(serialized).not.toContain('X-Custom');
    expect(serialized).toMatch(/input(?:%20| )withheld/);
  });
  it('withholds exact scalar and secret-reference inputs without changing static plan fields', () => {
    expect(
      resolvedApprovalPlan('WAIT', { durationSeconds: '${{ inputs.duration }}' }, { duration: 42 })
    ).toEqual([['Duration Seconds', '[input withheld]']]);
    expect(
      resolvedApprovalPlan(
        'BASH',
        { command: '${{ inputs.reference }}' },
        { reference: 'secret://private-id' }
      )
    ).toEqual([['Command', '[input withheld]']]);
    expect(
      resolvedApprovalPlan('HTTP', { method: 'GET', url: 'https://example.test/health' }, {})
    ).toEqual([
      ['Method', 'GET'],
      ['Url', 'https://example.test/health'],
    ]);
  });
  it('redacts arbitrary input values before JSON escaping, including nested evidence', () => {
    const result = formatDiagnosticEvidence(
      {
        before: { custom: `prefix ${opaque} suffix` },
        after: [{ custom: opaque, [opaque]: 'nested key' }],
        authorization: 'also-private',
      },
      { innocuous: opaque }
    );
    expect(result).not.toContain('unrecognizable-value');
    expect(result).not.toContain('also-private');
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('prefix');
  });
  it('preserves ordinary evidence when no submitted input is present', () => {
    expect(formatDiagnosticEvidence({ status: 'healthy' })).toContain('healthy');
    expect(formatDiagnosticEvidence(null)).toBe('Not recorded');
  });
});
