import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('canonical-origin guide states the implementation precedence exactly', () => {
  const guide = read('docs/v2.0.0/operate/deploy/application-url-and-host-routing.md');
  assert.match(guide, /SystemSettings\.appUrl.*NEXT_PUBLIC_APP_URL.*NEXTAUTH_URL.*localhost/s);
  assert.match(guide, /NEXTAUTH_URL.*NEXT_PUBLIC_APP_URL.*saved Application URL.*localhost/s);
  assert.match(guide, /TRUST_PROXY_HEADERS.*host and protocol/s);
  assert.match(guide, /TRUSTED_PROXY_HOPS.*client IP/s);
  assert.match(guide, /APP_HOST_ALIASES/);
  assert.match(guide, /REDIRECT_TO_CANONICAL_HOST/);
  assert.match(guide, /Migrate from one hostname to another/);
  assert.match(guide, /Do not make an ad hoc database edit/);
});

test('first-run setup warns before the irreversible host boundary', () => {
  const guide = read('docs/v2.0.0/start/initial-setup.md');
  assert.match(guide, /Before selecting Create administrator/);
  assert.match(guide, /421 Misdirected Request/);
  assert.match(guide, /SETUP_SECRET.*BOOTSTRAP_SECRET/s);
  assert.match(guide, /15–64 Unicode characters/);
  assert.match(guide, /Settings → System → App URL/);
});

test('every deployment path includes public setup and canonical-origin acceptance', () => {
  const paths = [
    'docs/v2.0.0/operate/deploy/docker-compose/README.md',
    'docs/v2.0.0/operate/deploy/helm/README.md',
    'docs/v2.0.0/operate/deploy/kustomize/README.md',
    'docs/v2.0.0/operate/deploy/kubernetes/README.md',
    'docs/v2.0.0/operate/deploy/swarm/README.md',
  ];
  for (const path of paths) {
    const page = read(path);
    assert.match(page, /initial setup/i, `${path} must link initial setup`);
    assert.match(page, /Application URL/i, `${path} must link canonical-origin guidance`);
    assert.match(page, /production (?:acceptance )?checklist/i, `${path} must retain acceptance`);
  }
});

test('proxy guides do not claim trusted proxy hops controls host routing', () => {
  const paths = [
    'docs/v2.0.0/operate/deploy/docker-compose/reverse-proxy.md',
    'docs/v2.0.0/operate/deploy/kubernetes/ingress.md',
    'docs/v2.0.0/operate/deploy/helm/ingress.md',
    'docs/v2.0.0/operate/deploy/reverse-proxy-contract.md',
  ];
  for (const path of paths) {
    const page = read(path);
    assert.match(page, /TRUST_PROXY_HEADERS/);
    assert.match(page, /TRUSTED_PROXY_HOPS/);
    assert.match(page, /client.IP|client address|client-IP|X-Forwarded-For/i);
  }
});
