export function controlledK6Target(env: Partial<NodeJS.ProcessEnv>) {
  const pod = env.AUTOMATION_K6_KUBERNETES_POD;
  if (!pod) return { mode: 'HOST' as const, endpoint: env.BASE_URL || 'http://127.0.0.1:3000' };
  if (pod !== 'k6-automation-cert' || env.AUTOMATION_K8S_NAMESPACE !== 'automation-cert')
    throw new Error('In-cluster load generation requires the owned automation-cert fixture');
  if (env.AUTOMATION_RPS !== '20' || env.AUTOMATION_DURATION !== '120s')
    throw new Error('In-cluster certification retains 20 RPS and 120-second measurements');
  return {
    mode: 'IN_CLUSTER' as const,
    pod,
    namespace: 'automation-cert',
    endpoint: 'http://automation.automation-cert.svc.cluster.local:3000',
  };
}

export function controlledK6Launch(
  env: Partial<NodeJS.ProcessEnv>,
  profile: string,
  runId: string,
  output: string
) {
  const target = controlledK6Target(env);
  if (target.mode === 'HOST')
    return {
      target,
      command: env.K6_BINARY || 'k6',
      args: ['run', '--summary-export', output, 'tests/load/scenarios/automation.js'],
      summaryPath: output,
    };
  if (!/^[a-z0-9-]+$/.test(profile) || !/^\d+$/.test(runId))
    throw new Error('Invalid controlled load execution identity');
  const summaryPath = `/work/results/${runId}.json`;
  return {
    target,
    command: 'kubectl',
    args: [
      '--context',
      'kind-opsknight-automation',
      '-n',
      target.namespace,
      'exec',
      target.pod,
      '--',
      'env',
      `BASE_URL=${target.endpoint}`,
      'LOAD_SEED_MANIFEST=/work/seed-manifest.json',
      'AUTOMATION_RPS=20',
      'AUTOMATION_DURATION=120s',
      `AUTOMATION_LOAD_PROFILE=${profile}`,
      `AUTOMATION_RUN_ID=${runId}`,
      `AUTOMATION_RECOVERY_DRILL=${env.AUTOMATION_RECOVERY_DRILL === 'true' ? 'true' : 'false'}`,
      'k6',
      'run',
      '--summary-export',
      summaryPath,
      '/work/scenarios/automation.js',
    ],
    summaryPath,
  };
}
