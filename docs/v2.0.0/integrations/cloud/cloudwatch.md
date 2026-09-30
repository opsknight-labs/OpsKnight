---
title: Amazon CloudWatch
description: Connect Amazon CloudWatch alerts to OpsKnight incident ingestion.
type: integration
reader:
  status: READER_COMPLETE
  task: Connect a CloudWatch alarm through a verified SNS topic and test trigger and recovery.
product_area: integrations
audience: [administrator, operator]
keywords: ["Amazon CloudWatch webhook", "connect Amazon CloudWatch", "Amazon CloudWatch alerts", "Amazon CloudWatch integration"]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/integrations/cloudwatch.ts
    - src/app/api/integrations/cloudwatch/route.ts
---

# Amazon CloudWatch

## What it does

The Amazon CloudWatch adapter accepts inbound webhook events at
`/api/integrations/cloudwatch`, validates them through its custom handler,
normalizes provider payloads, and submits lifecycle events to the configured
service.

## Prerequisites

- An OpsKnight service and enabled integration record.
- Permission to create or use an Amazon SNS topic and change CloudWatch alarm actions.
- The exact SNS topic ARN in the same AWS partition/region used for the alarm action.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

1. In **Amazon SNS → Topics**, create or select a Standard topic dedicated to the intended OpsKnight service/environment. Copy its full topic ARN.
2. In OpsKnight, open **Services → select service → Integrations → Add integration → Amazon CloudWatch**.
3. Enter the exact **SNS Topic ARN**, save, and copy the generated HTTPS endpoint containing `integrationId`.
4. In **Amazon SNS → Subscriptions → Create subscription**, select that topic, choose **HTTPS**, paste the OpsKnight endpoint, and create it.
5. Wait for the subscription to become **Confirmed**. OpsKnight accepts and follows the confirmation URL only after validating the SNS signature, topic ARN, AWS host, and subscription URL.
6. In **CloudWatch → Alarms**, create or edit the alarm. Under notification actions, send the required state changes to the same SNS topic. Configure at least `ALARM`; configure `OK` when recovery should resolve the incident. Decide deliberately whether `INSUFFICIENT_DATA` should page.
7. Save the alarm and use a controlled threshold/test metric or publish a representative SNS notification to validate the path.

Do not use an email subscription or an arbitrary generic webhook payload. CloudWatch alarm actions publish an alarm message to SNS, and SNS delivers its signed envelope to OpsKnight.

## Authentication and request verification

The endpoint requires `integrationId`. For SNS envelopes, OpsKnight validates the SNS schema, cryptographic signature and certificate URL, trusted AWS URL, and exact configured topic ARN before confirming a subscription or accepting a notification.
The exact payload schema is defined by `src/app/api/integrations/cloudwatch/route.ts` and `src/lib/integrations/cloudwatch.ts`.

- Method: `POST`
- Integration identifier: query parameter
- Integration key transports: none; SNS authenticity and topic binding protect SNS envelopes
- Schema: `shared provider schema`
- Body limit: 1048576 bytes (1 MiB)
- Rate limit: 100 requests per 60 seconds, per integration

## Event mapping and incident lifecycle

The adapter emits the lifecycle actions found in its current source:
- `trigger`
- `resolve`
Correlation depends on the provider identity selected by the adapter.

## Recovery and deduplication

The deduplication key is `cloudwatch-<AWS account when present><region>-<alarm name>`. An `ALARM` or `INSUFFICIENT_DATA` message triggers/updates that incident; an `OK` message resolves the same key. Renaming an alarm changes its identity. Failed requests are recorded for operational inspection without exposing secrets.

## Limits and testing

Per-integration rate limiting protects the ingestion path. Send a representative
trigger and recovery pair in a non-production service, verify that one incident
is created, and confirm that recovery updates that incident rather than creating
another.

## Verify the connection

After the test alert, confirm all of the following:

- One incident appears for the selected OpsKnight service.
- The incident source identifies Amazon CloudWatch.
- A repeat event updates or correlates according to the adapter identity.
- A recovery event resolves the correlated incident.

## Error reference

- This custom route does not expose the shared integration error contract.

## Troubleshooting

1. Confirm the integration is enabled, belongs to the intended service, and stores the exact topic ARN.
2. In SNS, confirm the HTTPS subscription is **Confirmed**, not `PendingConfirmation`, and its endpoint contains the correct integration ID.
3. Inspect **Settings → Integrations → Failures** for schema, topic-binding, certificate URL, or SNS signature errors.
4. Check SNS delivery status/logging and CloudWatch alarm action configuration in the same region.
5. Check for `413` or `429` before retrying rapidly.
6. Preserve SNS message ID, topic ARN, alarm/state, region, and timestamp when escalating; never expose credentials.

## Related pages

- [Integration troubleshooting](../../troubleshooting/integrations/webhook-rejected)
- [Incident lifecycle](../../concepts/incidents)
- [Services](../../concepts/services)
- [Events API](../../reference/api/events)

## Security

Use HTTPS, rotate exposed keys at both systems, configure signature verification
when supported, and restrict provider egress or ingress controls without blocking
legitimate retries.
