import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeFromFile } from '../../../scripts/docs/discovery-lib.mjs';
import { inspectConfig } from '../../../scripts/docs/inspect-config.mjs';
import { exportedHttpMethods } from '../../../scripts/docs/inspect-api.mjs';

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

describe('API method discovery', () => {
  it('detects direct, aliased, and re-exported route handlers', () => {
    assert.deepEqual(exportedHttpMethods(`
      export async function GET() {}
      const handler = () => {};
      export { handler as POST, handler as PATCH };
      export { DELETE } from '../shared';
    `), ['GET', 'POST', 'PATCH', 'DELETE']);
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
