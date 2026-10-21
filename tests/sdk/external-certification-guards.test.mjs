import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const valid = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/never_connect_test',
  API_KEY_SECRET: 'fixture-only-not-a-production-secret',
  API_SDK_TEST_PORT: '3160',
  API_SDK_EXTERNAL_BASE_URL: 'http://127.0.0.1:3160/api/v2',
  API_SDK_KUBERNETES_NAMESPACE: 'opsknight-api-886-072b69f',
  API_SDK_KUBERNETES_CONTEXT: 'kind-opsknight-cluster',
};
for (const [name, override] of [
  ['remote destination', { API_SDK_EXTERNAL_BASE_URL: 'http://example.test:3160/api/v2' }],
  [
    'credentials in URL',
    { API_SDK_EXTERNAL_BASE_URL: 'http://user:password@127.0.0.1:3160/api/v2' },
  ],
  ['wrong API path', { API_SDK_EXTERNAL_BASE_URL: 'http://127.0.0.1:3160/not-api' }],
  ['query string', { API_SDK_EXTERNAL_BASE_URL: 'http://127.0.0.1:3160/api/v2?q=value' }],
  ['fragment', { API_SDK_EXTERNAL_BASE_URL: 'http://127.0.0.1:3160/api/v2#value' }],
  ['absent signing secret', { API_KEY_SECRET: '' }],
  ['mismatched forward', { API_SDK_TEST_PORT: '3161' }],
  ['absent namespace', { API_SDK_KUBERNETES_NAMESPACE: '' }],
  ['unowned namespace', { API_SDK_KUBERNETES_NAMESPACE: 'production' }],
  ['wrong cluster', { API_SDK_KUBERNETES_CONTEXT: 'production-cluster' }],
]) {
  test(`external SDK mode rejects ${name} before network or database access`, () => {
    const child = spawnSync(process.execPath, ['tests/sdk/live-workflows.mjs'], {
      env: { ...process.env, ...valid, ...override },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /External SDK certification requires/);
  });
}
test('Kind wrapper requires explicit namespace and immutable revision before kubectl', () => {
  const child = spawnSync(process.execPath, ['tests/certification/kubernetes/sdk-kind.mjs'], {
    env: { ...process.env, API_SDK_KUBERNETES_NAMESPACE: '', API_SDK_SOURCE_REVISION: '' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Explicit certification namespace and source revision are required/);
});
