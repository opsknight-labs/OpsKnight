import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('incident SLA architecture boundary', () => {
  it('does not import legacy definition or snapshot symbols into incident SLA code', () => {
    const result = spawnSync(
      'git',
      [
        'grep',
        '-n',
        '-E',
        '^(import|export).*\\b(SLADefinition|SLASnapshot|generateDailySnapshot)\\b',
        '--',
        'src/lib/incident-sla/*.ts',
        'src/lib/incidents/*.ts',
        'src/lib/sla-breach-monitor.ts',
      ],
      { encoding: 'utf8' }
    );

    expect(result.error).toBeUndefined();
    expect(result.stdout, 'legacy incident-SLA imports').toBe('');
    expect(result.status).toBe(1);
  });
});
