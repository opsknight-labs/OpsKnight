import { expect, it } from 'vitest';
import { controlledK6Launch, controlledK6Target } from '../load/helpers/automation-k6';

const env = {
  AUTOMATION_K6_KUBERNETES_POD: 'k6-automation-cert',
  AUTOMATION_K8S_NAMESPACE: 'automation-cert',
  AUTOMATION_RPS: '20',
  AUTOMATION_DURATION: '120s',
};

it('preserves host execution and scopes the new topology to the owned fixture', () => {
  expect(controlledK6Launch({}, 'global-off', '123', '/tmp/result.json')).toMatchObject({
    command: 'k6',
    target: { mode: 'HOST' },
    summaryPath: '/tmp/result.json',
  });
  for (const override of [
    { AUTOMATION_K8S_NAMESPACE: 'production' },
    { AUTOMATION_K6_KUBERNETES_POD: 'other-workload' },
    { AUTOMATION_RPS: '10' },
    { AUTOMATION_DURATION: '30s' },
  ])
    expect(() => controlledK6Target({ ...env, ...override })).toThrow();
});

it('keeps all scenarios and frozen settings while retrieving a unique remote summary', () => {
  const launch = controlledK6Launch(
    env,
    'live-small',
    '123456',
    '/tmp/result.json',
    '10.96.137.17'
  );
  expect(launch.target).toMatchObject({ mode: 'IN_CLUSTER', namespace: 'automation-cert' });
  expect(launch.args).toEqual([
    '--context',
    'kind-opsknight-automation',
    '-n',
    'automation-cert',
    'exec',
    'k6-automation-cert',
    '--',
    'env',
    'BASE_URL=http://127.0.0.1:3439',
    'LOAD_SEED_MANIFEST=/work/seed-manifest.json',
    'AUTOMATION_RPS=20',
    'AUTOMATION_DURATION=120s',
    'AUTOMATION_LOAD_PROFILE=live-small',
    'AUTOMATION_RUN_ID=123456',
    'AUTOMATION_RECOVERY_DRILL=false',
    'k6',
    'run',
    '--config',
    '/work/results/123456-transport.json',
    '--summary-export',
    '/work/results/123456.json',
    '/work/scenarios/automation.js',
  ]);
  expect(launch.transportConfig).toEqual({ hosts: { '127.0.0.1:3439': '10.96.137.17:3000' } });
  for (const ip of [undefined, '127.0.0.1', '8.8.8.8', '10.999.1.1', 'not-an-ip'])
    expect(() => controlledK6Launch(env, 'live-small', '123456', '/tmp/result.json', ip)).toThrow();
  expect(() =>
    controlledK6Launch(env, 'live-small', '../old-result', '/tmp/result.json')
  ).toThrow();
});
