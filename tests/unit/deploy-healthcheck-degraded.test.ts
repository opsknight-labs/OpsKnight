import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifests: Array<[string, string]> = [
  ['deploy/compose/docker-compose.yml', readFileSync('deploy/compose/docker-compose.yml', 'utf8')],
  [
    'deploy/compose/docker-compose.split.yml',
    readFileSync('deploy/compose/docker-compose.split.yml', 'utf8'),
  ],
  ['deploy/swarm/docker-stack.yml', readFileSync('deploy/swarm/docker-stack.yml', 'utf8')],
  [
    'deploy/swarm/docker-stack.integrated.yml',
    readFileSync('deploy/swarm/docker-stack.integrated.yml', 'utf8'),
  ],
];

describe('deployment healthchecks', () => {
  it.each(manifests)(
    '%s treats a degraded readiness answer as healthy, like the image',
    (_file, text) => {
      expect(text).not.toContain("res.status===''healthy''");
      const probes = text.match(/res\.status[^?]*\?0:1/g) ?? [];
      expect(probes.length).toBeGreaterThan(0);
      for (const probe of probes) {
        expect(probe).toBe("res.status!==''unhealthy''&&r.statusCode<400?0:1");
      }
    }
  );

  it('the Swarm post-deploy script accepts degraded as well as healthy', () => {
    const script = readFileSync('deploy/swarm/scripts/health-check.sh', 'utf8');
    expect(script).toContain('(healthy|degraded)');
  });
});
