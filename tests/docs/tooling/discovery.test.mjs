import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeFromFile } from '../../../scripts/docs/discovery-lib.mjs';

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
