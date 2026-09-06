---
title: Integrations
description: Connect supported alert sources, notification providers, Slack ChatOps, Jira, and signed webhooks.
order: 4
---

# Integrations

OpsKnight integrations have three distinct directions:

| Direction             | Purpose                                                                                     | Examples                                              |
| --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Inbound               | Normalize a provider webhook into trigger, acknowledge, or resolve actions for one service. | CloudWatch, Datadog, Prometheus, CI/CD, uptime tools. |
| Outbound notification | Deliver incident and escalation messages to responders or external endpoints.               | Email, SMS, push, WhatsApp, Slack, service webhooks.  |
| Workflow              | Connect incident response to another working surface.                                       | Slack ChatOps war rooms and Jira issues/action items. |

There is no native voice/PSTN notification channel in v1.4. PagerDuty support is inbound Events API v2 compatibility, not a full PagerDuty product or bidirectional synchronization.

## Start here

1. Read [How integrations work](../core-concepts/integrations.md) for keys, URLs, signing, deduplication, recovery, and safe testing.
2. Read the [Inbound webhook reference](./inbound-webhook-reference.md) for the exact shared authentication, signature, lifecycle, rate-limit, and response contract.
3. Create the integration under **Service → Integrations**.
4. Follow the provider runbook below.
5. Trigger and resolve a synthetic alert using the exact production path.
6. Configure and test outbound [notification providers](../administration/notifications.md).

## Inbound integration catalog

These entries are backed by v1.4 route handlers. The provider guide is authoritative for payload and recovery behavior.

| Category              | Provider                | Webhook path                                                               | Guide                                                          |
| --------------------- | ----------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| APM and observability | AppDynamics             | `/api/integrations/appdynamics`                                            | [AppDynamics](apm-monitoring/appdynamics.md)                   |
| APM and observability | Datadog                 | `/api/integrations/datadog`                                                | [Datadog](apm-monitoring/datadog.md)                           |
| APM and observability | Dynatrace               | `/api/integrations/dynatrace`                                              | [Dynatrace](apm-monitoring/dynatrace.md)                       |
| APM and observability | Grafana                 | `/api/integrations/grafana`                                                | [Grafana](apm-monitoring/grafana.md)                           |
| APM and observability | Honeycomb               | `/api/integrations/honeycomb`                                              | [Honeycomb](apm-monitoring/honeycomb.md)                       |
| APM and observability | New Relic               | `/api/integrations/newrelic`                                               | [New Relic](apm-monitoring/new-relic.md)                       |
| APM and observability | Sentry                  | `/api/integrations/sentry`                                                 | [Sentry](apm-monitoring/sentry.md)                             |
| APM and observability | Splunk Observability    | `/api/integrations/splunk-observability`                                   | [Splunk Observability](apm-monitoring/splunk-observability.md) |
| Cloud                 | AWS CloudWatch          | `/api/integrations/cloudwatch`                                             | [AWS CloudWatch](cloud/aws-cloudwatch.md)                      |
| Cloud                 | Azure Monitor           | `/api/integrations/azure`                                                  | [Azure Monitor](cloud/azure-monitor.md)                        |
| Cloud                 | Google Cloud Monitoring | `/api/integrations/google-cloud-monitoring`                                | [Google Cloud Monitoring](cloud/google-cloud-monitoring.md)    |
| Metrics and alerting  | Icinga 2                | `/api/integrations/icinga`                                                 | [Icinga](metrics-alerting/icinga.md)                           |
| Metrics and alerting  | Nagios                  | `/api/integrations/nagios`                                                 | [Nagios](metrics-alerting/nagios.md)                           |
| Metrics and alerting  | Prometheus Alertmanager | `/api/integrations/prometheus`                                             | [Prometheus](metrics-alerting/prometheus.md)                   |
| Metrics and alerting  | Zabbix                  | `/api/integrations/zabbix`                                                 | [Zabbix](metrics-alerting/zabbix.md)                           |
| CI/CD                 | Bitbucket               | `/api/integrations/bitbucket`                                              | [Bitbucket](ci-cd/bitbucket.md)                                |
| CI/CD                 | GitHub                  | `/api/integrations/github`                                                 | [GitHub](ci-cd/github.md)                                      |
| CI/CD                 | GitLab                  | `/api/integrations/gitlab`                                                 | [GitLab](ci-cd/gitlab.md)                                      |
| CI/CD                 | Vercel                  | `/api/integrations/vercel`                                                 | [Vercel](ci-cd/vercel.md)                                      |
| Uptime                | Better Uptime           | `/api/integrations/better-uptime`                                          | [Better Uptime](uptime/better-uptime.md)                       |
| Uptime                | Pingdom                 | `/api/integrations/pingdom`                                                | [Pingdom](uptime/pingdom.md)                                   |
| Uptime                | Uptime Kuma             | `/api/integrations/uptime-kuma`                                            | [Uptime Kuma](uptime/uptime-kuma.md)                           |
| Uptime                | UptimeRobot             | `/api/integrations/uptimerobot`                                            | [UptimeRobot](uptime/uptimerobot.md)                           |
| Logs/events           | Elastic/Kibana          | `/api/integrations/elastic`                                                | [Elastic/Kibana](logs-events/elastic-kibana.md)                |
| Logs/events           | Splunk On-Call          | `/api/integrations/splunk-oncall`                                          | [Splunk On-Call](logs-events/splunk-oncall.md)                 |
| Compatibility         | PagerDuty Events API v2 | `/api/integrations/pagerduty` and `/api/integrations/pagerduty/v2/enqueue` | [PagerDuty-compatible ingest](custom/pagerduty-emulation.md)   |
| Custom                | Generic webhook         | `/api/integrations/webhook`                                                | [Custom webhooks](custom/webhooks.md)                          |

The application also has `/api/integrations/health` for authenticated integration-health inspection. It is an operational endpoint, not an inbound alert source.

## Outbound notification and workflow guides

| Capability                                              | Guide                                                   | Scope                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Email, SMS, push, WhatsApp, provider tests, and history | [Notifications](../administration/notifications.md)     | Workspace providers and user preferences.                             |
| Slack notifications                                     | [Slack](communication/slack.md)                         | Workspace connection and incident messages.                           |
| Slack OAuth                                             | [Slack OAuth setup](communication/slack-oauth-setup.md) | App credentials, scopes, redirect, and connection.                    |
| Slack ChatOps and war rooms                             | [Slack ChatOps](communication/slack-chatops.md)         | Dedicated incident channels, commands, and actions.                   |
| Jira Cloud                                              | [Jira](issue-tracking/jira.md)                          | Workspace configuration, service mapping, incident/action-item links. |
| Service webhooks                                        | [Custom webhooks](custom/webhooks.md)                   | Outbound lifecycle webhook configuration and signing.                 |

Microsoft Teams and Google Chat do not have dedicated native notification providers in the v1.4 provider model. A compatible incoming-webhook endpoint may accept a generic outbound webhook payload, but test its format explicitly and do not describe it as a native integration.

## Credential vocabulary

| Credential                    | Used for                                                                              | Created where                              |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| Integration ID                | Selects the service integration record on provider-native webhook routes.             | Service integration record.                |
| Integration key / routing key | Authorizes inbound provider-native and Events API traffic and routes it to a service. | Generated when the integration is created. |
| Signature secret              | Optionally verifies the raw provider webhook with the route's supported HMAC scheme.  | Rotated/cleared on the integration.        |
| Workspace API key             | Authorizes deliberately published API operations according to scopes.                 | **Settings → API Keys**.                   |
| Outbound webhook secret       | Signs OpsKnight-to-consumer requests.                                                 | Generated with the webhook configuration.  |

Never substitute one credential type for another. Keep them in secret storage and rotate after exposure.

## Production acceptance

An integration is ready only when:

- [ ] the provider can authenticate to the exact route;
- [ ] a representative failure creates the expected service incident and urgency;
- [ ] a repeated failure reuses the same deduplication key;
- [ ] recovery resolves that incident when supported;
- [ ] invalid key and invalid signature requests are rejected;
- [ ] a disabled integration rejects or stops processing as documented;
- [ ] rate limiting and retry behavior are understood;
- [ ] responders receive the intended outbound notifications;
- [ ] credential rotation and removal have been rehearsed.

## Troubleshooting

Start with [Event Logs](../core-concepts/event-logs.md), notification history, the incident timeline, and [Troubleshooting](../troubleshooting.md). A successful provider delivery only proves OpsKnight accepted the request; it does not prove escalation or outbound provider delivery succeeded.
