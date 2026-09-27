import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeFromFile } from '../../../scripts/docs/discovery-lib.mjs';
import { inspectConfig } from '../../../scripts/docs/inspect-config.mjs';

describe('documentation route discovery', () => {
  it('normalizes an API collection route', () => {
    assert.equal(routeFromFile('src/app/api/incidents/route.ts', 'src/app'), '/api/incidents');
  });

  it('preserves dynamic API segments', () => {
    assert.equal(
      routeFromFile('src/app/api/incidents/[id]/route.ts', 'src/app'),
      '/api/incidents/[id]'
    );
  });

  it('removes route groups from application pages', () => {
    assert.equal(routeFromFile('src/app/(app)/incidents/page.tsx', 'src/app/'), '/incidents');
  });
});

describe('configuration discovery', () => {
  it('classifies secret values without exposing a static default', () => {
    const variable = inspectConfig().find(entry => entry.name === 'NEXTAUTH_SECRET');
    assert.equal(variable?.secret, true);
    assert.deepEqual(variable?.defaults, []);
  });

  it('records runtime and deployment scopes', () => {
    const variable = inspectConfig().find(entry => entry.name === 'DATABASE_URL');
    assert.ok(variable?.scopes.includes('runtime'));
    assert.ok(variable?.scopes.includes('deployment'));
  });
});
