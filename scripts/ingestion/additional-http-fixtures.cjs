module.exports = run => [
  {
    type: 'CLOUDWATCH',
    route: 'cloudwatch',
    count: 1,
    format: 'direct-alarm',
    payload: {
      AlarmName: run,
      NewStateValue: 'ALARM',
      NewStateReason: 'HTTP alarm',
      StateChangeTime: new Date().toISOString(),
    },
  },
  {
    type: 'BITBUCKET',
    route: 'bitbucket',
    count: 1,
    signed: true,
    payload: {
      repository: { name: run, full_name: `certifier/${run}` },
      pipeline: { uuid: run, state: { name: 'COMPLETED', result: { name: 'FAILED' } } },
    },
  },
  {
    type: 'MANAGEENGINE',
    route: 'manageengine',
    count: 1,
    signed: true,
    payload: {
      alarmid: run,
      message: 'HTTP alarm',
      severity: 'critical',
      status: 'triggered',
      entity: 'HTTP certifier',
    },
  },
  {
    type: 'PAGERDUTY',
    route: 'pagerduty',
    count: 1,
    credentialHeader: 'Authorization',
    payload: {
      event_action: 'trigger',
      dedup_key: run,
      payload: { summary: 'HTTP event', source: 'certifier', severity: 'critical' },
    },
  },
  {
    type: 'GITHUB',
    route: 'github',
    count: 1,
    signed: true,
    payload: {
      action: 'completed',
      repository: {
        name: run,
        full_name: `certifier/${run}`,
        html_url: 'https://example.test/repo',
      },
      workflow_run: {
        id: 123,
        name: 'HTTP workflow',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://example.test/run',
      },
    },
  },
  {
    type: 'GITLAB',
    route: 'gitlab',
    count: 1,
    signed: true,
    payload: {
      object_kind: 'pipeline',
      build_status: 'failed',
      object_attributes: { id: 123, status: 'failed' },
      project: { name: run, path_with_namespace: `certifier/${run}` },
      ref: 'main',
    },
  },
  {
    type: 'SENTRY',
    route: 'sentry',
    count: 1,
    signed: true,
    payload: {
      action: 'created',
      issue: { id: run, title: 'HTTP issue', level: 'fatal', status: 'unresolved' },
    },
  },
  {
    type: 'VERCEL',
    route: 'vercel',
    count: 1,
    signed: true,
    payload: {
      id: run,
      type: 'deployment.error',
      payload: {
        project: { id: run, name: run },
        target: 'production',
        error: { message: 'HTTP deployment failed' },
      },
    },
  },
];
