import type { IntegrationType } from '@/components/service/integration-types';

/**
 * Build the URL an external monitoring tool posts alerts to for one integration.
 *
 * `appBaseUrl` is the resolved application URL (Settings -> System -> App URL, then
 * NEXT_PUBLIC_APP_URL, then NEXTAUTH_URL; see `getAppUrl()` in `@/lib/app-url`). Resolve it
 * once per render and pass it in so this stays pure. Trailing slashes are removed so the
 * result never contains `//api`.
 */
export function getWebhookUrl(
  appBaseUrl: string,
  integrationType: IntegrationType,
  integrationId: string,
  integrationKey: string
): string {
  const baseUrl = appBaseUrl.replace(/\/+$/, '');
  const keyParam = `&integrationKey=${encodeURIComponent(integrationKey)}`;

  switch (integrationType) {
    case 'CLOUDWATCH':
      return `${baseUrl}/api/integrations/cloudwatch?integrationId=${integrationId}${keyParam}`;
    case 'AZURE':
      return `${baseUrl}/api/integrations/azure?integrationId=${integrationId}${keyParam}`;
    case 'DATADOG':
      return `${baseUrl}/api/integrations/datadog?integrationId=${integrationId}${keyParam}`;
    case 'GRAFANA':
      return `${baseUrl}/api/integrations/grafana?integrationId=${integrationId}${keyParam}`;
    case 'PROMETHEUS':
      return `${baseUrl}/api/integrations/prometheus?integrationId=${integrationId}${keyParam}`;
    case 'NEWRELIC':
      return `${baseUrl}/api/integrations/newrelic?integrationId=${integrationId}${keyParam}`;
    case 'SENTRY':
      return `${baseUrl}/api/integrations/sentry?integrationId=${integrationId}${keyParam}`;
    case 'GITHUB':
      return `${baseUrl}/api/integrations/github?integrationId=${integrationId}${keyParam}`;
    case 'GOOGLE_CLOUD_MONITORING':
      return `${baseUrl}/api/integrations/google-cloud-monitoring?integrationId=${integrationId}${keyParam}`;
    case 'SPLUNK_ONCALL':
      return `${baseUrl}/api/integrations/splunk-oncall?integrationId=${integrationId}${keyParam}`;
    case 'SPLUNK_OBSERVABILITY':
      return `${baseUrl}/api/integrations/splunk-observability?integrationId=${integrationId}${keyParam}`;
    case 'DYNATRACE':
      return `${baseUrl}/api/integrations/dynatrace?integrationId=${integrationId}${keyParam}`;
    case 'APPDYNAMICS':
      return `${baseUrl}/api/integrations/appdynamics?integrationId=${integrationId}${keyParam}`;
    case 'ELASTIC':
      return `${baseUrl}/api/integrations/elastic?integrationId=${integrationId}${keyParam}`;
    case 'HONEYCOMB':
      return `${baseUrl}/api/integrations/honeycomb?integrationId=${integrationId}${keyParam}`;
    case 'BITBUCKET':
      return `${baseUrl}/api/integrations/bitbucket?integrationId=${integrationId}${keyParam}`;
    case 'UPTIMEROBOT':
      return `${baseUrl}/api/integrations/uptimerobot?integrationId=${integrationId}${keyParam}`;
    case 'PINGDOM':
      return `${baseUrl}/api/integrations/pingdom?integrationId=${integrationId}${keyParam}`;
    case 'BETTER_UPTIME':
      return `${baseUrl}/api/integrations/better-uptime?integrationId=${integrationId}${keyParam}`;
    case 'UPTIME_KUMA':
      return `${baseUrl}/api/integrations/uptime-kuma?integrationId=${integrationId}${keyParam}`;
    case 'NAGIOS':
      return `${baseUrl}/api/integrations/nagios?integrationId=${integrationId}${keyParam}`;
    case 'ICINGA':
      return `${baseUrl}/api/integrations/icinga?integrationId=${integrationId}${keyParam}`;
    case 'ZABBIX':
      return `${baseUrl}/api/integrations/zabbix?integrationId=${integrationId}${keyParam}`;
    case 'MANAGEENGINE':
      return `${baseUrl}/api/integrations/manageengine?integrationId=${integrationId}${keyParam}`;
    case 'PAGERDUTY':
      return `${baseUrl}/api/integrations/pagerduty/v2/enqueue?integrationId=${integrationId}${keyParam}`;
    case 'GITLAB':
      return `${baseUrl}/api/integrations/gitlab?integrationId=${integrationId}${keyParam}`;
    case 'VERCEL':
      return `${baseUrl}/api/integrations/vercel?integrationId=${integrationId}${keyParam}`;
    case 'WEBHOOK':
      return `${baseUrl}/api/integrations/webhook?integrationId=${integrationId}${keyParam}`;
    case 'EVENTS_API_V2':
    default:
      return `${baseUrl}/api/events`;
  }
}
