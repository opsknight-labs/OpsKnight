---
order: 8
title: Splunk Observability Cloud
description: Send detector alerts to OpsKnight with explicit payload, correlation, clear-event, signature, and retry boundaries
---

# Splunk Observability Cloud

Send detector notifications to an OpsKnight service through a Splunk Observability Cloud webhook integration. Validate trigger and clear behavior with your rendered payload before relying on automatic recovery.

## Create the OpsKnight integration

1. In OpsKnight, open **Services**, select the service, and open **Integrations**.
2. Add **Splunk Observability** and copy the complete URL:

```text
https://OPSKNIGHT_HOST/api/integrations/splunk-observability?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

Treat the URL as a credential. OpsKnight validates the integration key on every request.

## Configure Splunk Observability

As a Splunk Observability administrator, open **Data Management**, find **Webhook**, and create a new integration:

- URL: the complete OpsKnight webhook URL;
- method: `POST`;
- content type: `application/json`; and
- message: a JSON object that supplies the fields below.

Then add the webhook as a recipient on each intended detector.

The adapter accepts:

```json
{
  "incidentId": "stable-alert-instance-id",
  "detectorId": "stable-detector-id",
  "detectorName": "Production API latency",
  "title": "Production API latency is critical",
  "description": "P99 latency crossed the threshold",
  "severity": "critical",
  "status": "active",
  "eventType": "trigger",
  "link": "https://app.signalfx.com/#/detector/EXAMPLE"
}
```

Use the current template variables offered by Splunk's message editor to populate these fields. Do not paste the literal example IDs into production.

## Clear-event boundary

OpsKnight v1.3 resolves only when `status` (preferred) or `eventType` contains `resolve`, `resolved`, `close`, `closed`, `recover`, `recovered`, `ok`, or `up`. The common Splunk values `CLEAR` and `Cleared` are **not** recognized as recovery by the v1.3 normalizer.

If your rendered clear notification contains only `CLEAR`/`Cleared`, it will trigger instead of resolve. Use a tested intermediary that changes clear events to `status: resolved`, or resolve manually. Do not claim automatic recovery until a real detector trigger/clear pair has updated the same OpsKnight incident.

## Correlation and severity

The key is selected in this order:

1. `incidentId`;
2. `detectorId`; or
3. normalized `detectorName`/`title`.

If trigger uses `incidentId` but clear omits it and falls back to `detectorId`, recovery cannot match. Keep the same highest-priority identifier in both deliveries.

Summary uses `title`, detector name, then description. Severity recognizes common critical/high, error, warning/degraded, and info/low terms, defaulting to warning. OpsKnight service urgency rules determine final incident urgency.

## Signature boundary

Splunk Observability supports a provider-specific shared-secret mechanism, but OpsKnight v1.3's generic route expects an unprefixed raw-body HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`. Do not assume the two formats match.

For direct delivery, leave the OpsKnight signing secret unset and protect the credential URL with HTTPS and network controls. For signed delivery, validate Splunk's signature at a gateway and have the gateway generate OpsKnight's generic header contract.

## Validate end to end

1. Use Splunk's webhook test and confirm OpsKnight returns HTTP `202`.
2. Trigger a controlled detector and record the raw JSON, selected key, and incident.
3. Clear the condition and capture the clear payload.
4. Confirm its status is a recognized recovery value and its key matches.
5. Confirm the original incident resolves rather than a new incident being created.
6. Verify outbound paging separately.

Splunk can retry failed notifications for an extended period. A delayed old trigger can reopen a correlation after recovery, so inspect provider delivery time and event content when an incident unexpectedly returns.

## Troubleshooting

**OpsKnight returns `401`**

Restore the complete URL with its current integration key. If an OpsKnight signing secret is configured, use a compatible gateway or remove it for direct delivery.

**Clear creates/reopens an incident**

Inspect the rendered `status` and `eventType`. `CLEAR`/`Cleared` is the known v1.3 mismatch; map it to `resolved` before forwarding.

**Clear cannot find the incident**

Compare `incidentId`, then `detectorId`, across both payloads. Field precedence must not change.

**Splunk retries the request**

OpsKnight normally returns `202`, not `200`. Confirm your Splunk integration treats any 2xx as success. If it requires exactly `200`, use a bridge that acknowledges Splunk immediately and forwards reliably.

**OpsKnight returns `429`**

The default is 100 requests per 60 seconds per integration. Honor retry/reset headers and reduce detector fan-out.

## Related topics

- [Splunk Observability webhook documentation](https://help.splunk.com/en/splunk-observability-cloud/create-alerts-detectors-and-service-level-objectives/send-alert-notifications-to-other-services/send-alerts-to-webhook)
- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
