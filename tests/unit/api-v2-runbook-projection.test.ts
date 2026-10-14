import { describe, expect, it } from 'vitest';
import { projectRunbookSteps } from '@/lib/api-v2/runbook-projection';

describe('projectRunbookSteps', () => {
  const definition = {
    steps: [
      {
        key: 'restart',
        name: 'Restart api',
        type: 'BASH',
        riskClass: 'NON_IDEMPOTENT',
        config: {
          script: 'curl -H "Authorization: Bearer abc" https://x',
          env: { DB_PASSWORD: 'p' },
        },
        timeoutSeconds: 60,
        precheck: {
          steps: [{ key: 'p', name: 'check', type: 'HTTP', config: { url: 'https://secret' } }],
        },
        verification: { steps: [], delaySeconds: 5 },
      },
      { key: 'wait', name: 'Wait', type: 'WAIT', riskClass: 'READ_ONLY', config: { seconds: 5 } },
    ],
  };

  it('never exposes step configuration or executable material', () => {
    const json = JSON.stringify(projectRunbookSteps(definition));
    expect(json).not.toContain('Authorization');
    expect(json).not.toContain('DB_PASSWORD');
    expect(json).not.toContain('https://secret');
    expect(json).not.toContain('"config"');
  });

  it('exposes what a caller needs to understand the step', () => {
    const [restart, wait] = projectRunbookSteps(definition);
    expect(restart).toMatchObject({
      key: 'restart',
      type: 'BASH',
      riskClass: 'NON_IDEMPOTENT',
      requiresAgent: true,
      timeoutSeconds: 60,
    });
    expect(restart.precheckSteps[0]).toMatchObject({
      key: 'p',
      type: 'HTTP',
      requiresAgent: false,
    });
    expect(wait.requiresAgent).toBe(false);
  });

  it('tolerates malformed definitions', () => {
    expect(projectRunbookSteps(null)).toEqual([]);
    expect(projectRunbookSteps({ steps: [null, 7] })).toHaveLength(2);
  });
});
