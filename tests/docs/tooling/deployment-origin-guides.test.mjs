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
  assert.match(guide, /opsknight_opsknight-app/, 'integrated Swarm bootstrap service must be documented');
  assert.match(guide, /opsknight_opsknight-web/, 'split Swarm bootstrap service must be documented');
  assert.match(guide, /DATABASE_URL_FILE/, 'Swarm bootstrap must load its database secret file');
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

test('every maintained deployment package delivers the documented public-origin controls', () => {
  const variables = [
    'TRUST_PROXY_HEADERS',
    'TRUSTED_PROXY_HOPS',
    'APP_HOST_ALIASES',
    'REDIRECT_TO_CANONICAL_HOST',
    'SETUP_SECRET',
  ];
  const artifacts = {
    composeIntegrated: read('deploy/compose/docker-compose.yml'),
    composeSplit: read('deploy/compose/docker-compose.split.yml').split('  opsknight-web:')[1],
    swarmIntegrated: read('deploy/swarm/docker-stack.integrated.yml'),
    swarmSplit: read('deploy/swarm/docker-stack.yml').split('  opsknight-web:')[1],
    helmValues: read('deploy/kubernetes/helm/opsknight/values.yaml'),
    helmConfig: read('deploy/kubernetes/helm/opsknight/templates/configmap.yaml'),
    helmSecret: read('deploy/kubernetes/helm/opsknight/templates/secret.yaml'),
    helmIntegrated: read('deploy/kubernetes/helm/opsknight/templates/deployment.yaml'),
    helmSplit: read('deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml'),
    kustomizeConfig: read('deploy/kubernetes/kustomize/base/configmap.yaml'),
    kustomizeSecret: read('deploy/kubernetes/kustomize/base/secret.yaml'),
  };

  for (const name of ['composeIntegrated', 'composeSplit', 'swarmIntegrated', 'swarmSplit']) {
    for (const variable of variables) {
      assert.match(artifacts[name], new RegExp(`\\b${variable}\\b`), `${name} must deliver ${variable}`);
    }
  }
  for (const variable of variables.slice(0, 4)) {
    assert.match(artifacts.helmConfig, new RegExp(variable));
    assert.match(artifacts.kustomizeConfig, new RegExp(variable));
  }
  assert.match(artifacts.helmValues, /setupSecret: SETUP_SECRET/);
  assert.match(artifacts.helmSecret, /setupSecret/);
  assert.match(artifacts.helmIntegrated, /name: SETUP_SECRET/);
  assert.match(artifacts.helmSplit, /name: SETUP_SECRET/);
  assert.match(artifacts.kustomizeSecret, /SETUP_SECRET/);
});
