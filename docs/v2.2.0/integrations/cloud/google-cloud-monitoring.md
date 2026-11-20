---
title: Connect Google Cloud Monitoring
description: Route Google Cloud Monitoring incidents through an authenticated webhook notification channel to OpsKnight.
type: integration
product_area: integrations
audience: [administrator, operator]
keywords: [Google Cloud Monitoring webhook, GCP alerting, notification channel, GCP incidents]
reader:
  status: READER_COMPLETE
  task: Connect, test, and operate a Google Cloud Monitoring webhook notification channel.
verification:
  level: source
  verified_at: 2026-09-30
  evidence: [src/lib/integrations/google-cloud-monitoring.ts, src/app/api/integrations/google-cloud-monitoring/route.ts, src/lib/integrations/auth.ts]
---

# Connect Google Cloud Monitoring

Google Cloud Monitoring sends incident JSON to an HTTPS notification channel. OpsKnight triggers when the incident opens, resolves when it closes, and correlates updates by Google incident ID or, as a fallback, policy and resource identity.

## Prerequisites

- An OpsKnight service you can manage.
- Google Cloud `roles/monitoring.editor`, or equivalent permissions to manage notification channels and alerting policies.
- A public HTTPS OpsKnight endpoint with a publicly trusted certificate. The direct connection documented here requires a public webhook path.
- A non-production policy condition you can safely trigger and clear.

The complete generated URL is secret because it contains the integration key. Do not paste it into tickets, logs, or source control.

## Setup and configuration

### Create the OpsKnight endpoint

1. Open **Services → your service → Integrations**.
2. Select **Add integration → Google Cloud Monitoring**, name it for the project or environment, and save.
3. Copy the complete webhook URL exactly as displayed.

### Create the notification channel

1. In Google Cloud Console, select the correct project and open **Monitoring → Alerting**.
2. Select **Edit notification channels**.
3. In **Webhooks**, select **Add New**.
4. Enter a display name and paste the complete OpsKnight URL into **Endpoint URL**.
5. Do not add separate Basic authentication. The generated query parameter supplies the OpsKnight integration key over TLS.
6. Select **Test Connection** if the console offers it, then check OpsKnight for the received sample. Save the channel.

Test availability varies by channel and workflow. If the console does not offer a usable test, verify with a temporary alert policy.

### Attach the channel to a policy

1. Open **Monitoring → Alerting → Policies**, then create or edit the intended policy.
2. Configure the resource, condition, threshold, retest window, and incident autoclose behavior.
3. Expand **Notifications and name**, choose **Notification channels**, and select the OpsKnight webhook.
4. Add responder-facing documentation, then save the policy.

## Verify the connection

1. Make the non-production condition true and wait for Google Cloud to open an incident.
2. Confirm OpsKnight creates exactly one incident on the intended service and identifies Google Cloud Monitoring as the source.
3. Let the policy evaluate again while still open. Confirm repeated notifications update the same incident.
4. Clear the condition and wait for Google Cloud to close its incident. Confirm the OpsKnight incident resolves rather than creating a second record.
5. Remove the temporary policy or restore its production threshold.

## Use and event mapping

OpsKnight prefers `incident.incident_id` for deduplication. If absent, it derives a stable key from policy and resource; a final fallback uses the summary. The summary, policy, monitored resource, labels, timestamps, severity, and original payload remain available as details. Provider states normalize to trigger, acknowledge, or resolve actions.

The endpoint accepts both the direct Monitoring webhook object and a Pub/Sub push envelope whose `message.data` contains base64-encoded JSON. Requests are limited to 1 MiB and 100 requests per integration per 60 seconds.

## Rotate, disable, or remove the connection

Create a replacement OpsKnight integration, edit the Google webhook channel to use its URL, test a complete open/close cycle, and then disable the old integration. Google Cloud Console will not delete a channel still attached to an alerting policy; detach it first.

## Troubleshooting

**Test Connection fails:** verify public DNS, HTTPS certificate trust, port 443, and that the complete URL was pasted without escaping or truncation.

**OpsKnight returns 401/403:** the integration key is absent or stale. Copy the current complete endpoint from the service integration.

**No notification was sent:** confirm the channel is attached to the policy, the condition opened an incident, and inspect Google Cloud Logs Explorer for notification-channel errors.

**Multiple OpsKnight incidents appear:** inspect `incident.incident_id`, policy, and resource fields. Do not transform away the provider incident ID.

**The incident stays open:** confirm Google Cloud closed the source incident and emitted `incident.state: closed`; review autoclose and missing-data behavior.

## Related pages

- [Integration troubleshooting](../../troubleshooting/integrations/webhook-rejected)
- [Incident lifecycle](../../concepts/incidents)
- [Integration failures](../../guides/notifications/inspect-delivery)
