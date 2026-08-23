---
order: 3
title: Google Cloud Monitoring
description: Send Cloud Monitoring incident notifications to OpsKnight by public webhook or a controlled Pub/Sub push bridge
---

# Google Cloud Monitoring

Connect a Google Cloud Monitoring alerting policy to an OpsKnight service. The adapter accepts Monitoring's `incident` JSON and also unwraps a Pub/Sub push envelope whose `message.data` contains base64-encoded JSON.

## Choose a delivery path

- **Transforming bridge (recommended for v1.3):** use Cloud Run, a function, or another controlled consumer to normalize the payload, attach the OpsKnight credential, and optionally sign it.
- **Direct public webhook:** use only after a real notification from your policy passes the v1.3 schema. Google's direct webhook requires a public endpoint and a publicly trusted certificate.

Cloud Monitoring's 1.2 payload commonly represents `incident.started_at` and `incident.ended_at` as numbers. OpsKnight v1.3 accepts those two fields only as strings when present. A standard direct delivery containing numeric timestamps is rejected with `400`; a Pub/Sub envelope does not remove this mismatch because OpsKnight decodes and validates its inner JSON. A bridge must stringify or remove those two fields before forwarding.

## Create the OpsKnight integration

1. Open **Services**, select the target service, and open **Integrations**.
2. Add **Google Cloud Monitoring**.
3. Copy the complete generated URL:

```text
https://OPSKNIGHT_HOST/api/integrations/google-cloud-monitoring?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

The URL is a credential. OpsKnight always validates the integration key.

The generic signing option is usable only if a sender or bridge computes an unprefixed HMAC-SHA256 digest over the exact raw body and sends it in `X-Signature` or `X-Webhook-Signature`. Cloud Monitoring's direct webhook does not natively provide that OpsKnight header contract, so leave the OpsKnight signing secret unset for a direct connection or use a validating bridge.

## Configure a direct webhook

1. In Google Cloud, open **Monitoring → Alerting → Edit notification channels**.
2. Under **Webhooks**, add a channel using the complete OpsKnight URL.
3. Save it, then add the channel to each intended alerting policy.
4. Exercise an actual test policy. If OpsKnight returns `400` for numeric timestamps, use the bridge path; do not discard the fields at an untrusted edge.

For a bridge, preserve the original incident context, change only the incompatible timestamp representation, and forward JSON like:

```json
{
  "incident": {
    "incident_id": "0.example",
    "state": "open",
    "summary": "Production API latency is high",
    "policy_name": "API latency",
    "severity": "critical",
    "started_at": "1724414400"
  }
}
```

## Action and correlation contract

| Incoming value                                                   | OpsKnight behavior            |
| ---------------------------------------------------------------- | ----------------------------- |
| `incident.state: open` or another non-recovery value             | Trigger                       |
| `incident.state: closed`, `resolved`, `recovered`, `ok`, or `up` | Resolve                       |
| A value containing `ack`/`acknowledge`                           | Acknowledge an existing match |

Correlation uses `incident.incident_id` when present. Otherwise it falls back to policy + resource, policy alone, or a normalized summary. Ensure recovery carries the original `incident_id`; otherwise it can miss the active incident.

Summary preference is incident summary, top-level summary, condition name, then policy name. Severity uses incident severity or top-level severity and defaults to warning. OpsKnight's service urgency rules still determine final incident urgency and paging.

## Pub/Sub envelope

The endpoint recognizes this outer shape and parses `message.data` as base64-encoded JSON:

```json
{
  "message": {
    "messageId": "1234567890",
    "publishTime": "2026-08-23T12:00:00Z",
    "data": "BASE64_ENCODED_MONITORING_JSON"
  },
  "subscription": "projects/example/subscriptions/opsknight-alerts"
}
```

If decoding or JSON parsing fails, the adapter treats the outer envelope as the event. That can create an unhelpful fallback incident, so monitor bridge errors and reject malformed messages before forwarding.

## Validate end to end

1. Create a disposable alerting policy with a safely reachable threshold.
2. Trigger it and confirm the sender receives HTTP `202`.
3. Confirm one incident appears on the intended OpsKnight service and record its key.
4. Clear the condition.
5. Confirm the closed notification carries the same incident ID and resolves the same incident.
6. Verify outbound paging independently.

## Troubleshooting

**Google reports an unreachable webhook**

Confirm public DNS, port 443, certificate trust, proxy routing, and that the complete URL—including query parameters—reaches OpsKnight.

**OpsKnight returns `400` for a native notification**

Inspect the response and delivered JSON. Numeric `incident.started_at`/`incident.ended_at` is the known v1.3 mismatch; normalize those values to strings in a bridge and replay a controlled current event.

**OpsKnight returns `401`**

The integration key is missing/wrong, or a signing secret is configured without the exact generic signature header. Rotate a leaked URL rather than reusing it.

**The incident does not resolve**

Compare the opening and closing `incident.incident_id`. Also confirm the policy actually sends closed notifications rather than remaining open until its autoclose timer.

**OpsKnight returns `429`**

The default is 100 requests per 60 seconds per integration. Honor retry/reset headers and reduce policy fan-out or use separate service integrations where appropriate.

## Related topics

- [Google Cloud notification channels](https://cloud.google.com/monitoring/support/notification-options)
- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
