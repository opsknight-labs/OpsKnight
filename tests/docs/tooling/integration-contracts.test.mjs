import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const catalog = JSON.parse(readFileSync('generated/docs-contracts/integrations.json', 'utf8'));
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]
);

describe('normalized integration documentation contracts', () => {
  it('covers every discovered inbound provider exactly once', () => {
    assert.equal(catalog.providers.length, 28);
    assert.equal(new Set(catalog.providers.map(provider => provider.id)).size, 28);
  });

  it('resolves inherited shared-handler security and limits', () => {
    for (const provider of catalog.providers.filter(item => item.handler === 'shared')) {
      assert.deepEqual(provider.authentication, ['integration-key'], provider.id);
      assert.equal(provider.request.bodyLimitBytes, 1024 * 1024, provider.id);
      assert.deepEqual(provider.request.rateLimit, { requests: 100, windowSeconds: 60 }, provider.id);
      assert.ok(provider.request.integrationKey.includes('x-integration-key'), provider.id);
      assert.ok(provider.errors.some(error => error.status === 413), provider.id);
      assert.ok(provider.errors.some(error => error.status === 429), provider.id);
    }
  });

  it('keeps every contract tied to implementation evidence', () => {
    for (const provider of catalog.providers) {
      assert.match(provider.source, /^src\/lib\/integrations\/.+\.ts$/);
      assert.match(provider.route, /^src\/app\/api\/integrations\/.+\/route\.ts$/);
      assert.ok(provider.sharedContracts.length > 0);
    }
  });

  it('publishes exact release contracts without unresolved placeholders', () => {
    const unresolved = /unknown|not-declared|not statically resolved/i;
    for (const provider of catalog.providers) {
      assert.ok(provider.acceptedActions.length > 0, `${provider.id}: lifecycle actions unresolved`);
      assert.ok(provider.authentication.length > 0, `${provider.id}: authentication unresolved`);
      assert.equal(provider.request.bodyLimitBytes, 1024 * 1024, `${provider.id}: body limit`);
      assert.deepEqual(provider.request.rateLimit, { requests: 100, windowSeconds: 60 }, `${provider.id}: rate limit`);
      assert.ok(provider.errors.length > 0, `${provider.id}: errors unresolved`);
      assert.doesNotMatch(JSON.stringify(provider), unresolved, provider.id);
    }
    const published = walk('docs/v2.0.0/integrations')
      .filter(file => file.endsWith('.md'))
      .map(file => readFileSync(file, 'utf8'))
      .join('\n');
    assert.doesNotMatch(published, /not statically resolved|not-declared|custom route does not expose|Correlation depends/i);
  });
});
