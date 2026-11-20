/** Supported inbound providers. Keep route schemas and the public type catalog derived from this list. */
export const INTEGRATION_TYPES = [
  'EVENTS_API_V2',
  'CLOUDWATCH',
  'AZURE',
  'DATADOG',
  'GITHUB',
  'GRAFANA',
  'BASE14',
  'PROMETHEUS',
  'NEWRELIC',
  'SENTRY',
  'GOOGLE_CLOUD_MONITORING',
  'SPLUNK_ONCALL',
  'SPLUNK_OBSERVABILITY',
  'DYNATRACE',
  'APPDYNAMICS',
  'ELASTIC',
  'HONEYCOMB',
  'BITBUCKET',
  'UPTIMEROBOT',
  'PINGDOM',
  'BETTER_UPTIME',
  'UPTIME_KUMA',
  'NAGIOS',
  'ICINGA',
  'ZABBIX',
  'MANAGEENGINE',
  'PAGERDUTY',
  'GITLAB',
  'VERCEL',
  'WEBHOOK',
] as const;

/**
 * Providers that cannot HMAC-sign webhook bodies (or sign with a vendor-held secret OpsKnight cannot
 * import). A generated signing secret can never be matched by these senders, so the UI does not offer one.
 */
export const UNSIGNABLE_INTEGRATION_TYPES: ReadonlySet<string> = new Set([
  'CLOUDWATCH',
  'AZURE',
  'DATADOG',
  'PROMETHEUS',
  'NEWRELIC',
  'SENTRY',
  'GOOGLE_CLOUD_MONITORING',
  'SPLUNK_OBSERVABILITY',
  'DYNATRACE',
  'APPDYNAMICS',
  'ELASTIC',
  'HONEYCOMB',
]);
