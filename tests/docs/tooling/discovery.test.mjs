import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routeFromFile } from '../../../scripts/docs/discovery-lib.mjs';
import { inspectConfig } from '../../../scripts/docs/inspect-config.mjs';
import { effectiveRouteSources, exportedHttpMethods, inspectApi } from '../../../scripts/docs/inspect-api.mjs';
import { inspectNotificationProviders } from '../../../scripts/docs/inspect-notification-providers.mjs';

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

  it('resolves shared integration handler semantics', () => {
    const sources = effectiveRouteSources('src/app/api/integrations/datadog/route.ts');
    assert.ok(sources.includes('src/lib/integrations/handler.ts'));
    const route = inspectApi().find(item => item.route === '/api/integrations/datadog');
    assert.deepEqual(route?.authentication, ['integration-key']);
    assert.equal(route?.rateLimited, true);
    assert.equal(route?.bodyLimited, true);
    assert.equal(route?.deliveryFencing, true);
  });
});

describe('notification provider discovery', () => {
  it('derives WhatsApp support from its implementation', () => {
    const provider = inspectNotificationProviders().find(item => item.id === 'whatsapp.twilio');
    assert.equal(provider?.discovery, 'implementation');
    assert.ok(provider?.requiredCredentials.includes('whatsappNumber'));
    assert.notEqual(provider?.enabledCondition, 'unknown');
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
