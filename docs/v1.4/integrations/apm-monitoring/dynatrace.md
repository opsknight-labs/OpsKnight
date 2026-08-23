---
order: 3
title: Dynatrace
description: Send Dynatrace problem open and resolve notifications to OpsKnight with stable ProblemID correlation
---

# Dynatrace

Use a Dynatrace custom problem notification to trigger and resolve an OpsKnight incident. Recovery depends on both notifications carrying the same `ProblemID`.

## Create the OpsKnight integration

1. In OpsKnight, open **Services**, select the service, and open **Integrations**.
2. Add **Dynatrace** and copy its complete webhook URL:

```text
https://OPSKNIGHT_HOST/api/integrations/dynatrace?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

Treat the URL as a credential. The `integrationKey` is required.

Dynatrace's direct custom webhook does not implement OpsKnight's generic HMAC header contract. Leave the OpsKnight signing secret unset for direct delivery, or send through a trusted bridge that computes an unprefixed HMAC-SHA256 digest over the raw body in `X-Signature` or `X-Webhook-Signature`.

## Configure Dynatrace

In Dynatrace Classic, open **Settings → Integration → Problem notifications**, add a **Custom integration**, and set the webhook URL to the complete OpsKnight URL. Use JSON content type and this payload:

```json
{
  "ProblemID": "{ProblemID}",
  "ProblemTitle": "{ProblemTitle}",
  "ProblemDetailsText": "{ProblemDetailsText}",
  "State": "{State}",
  "ProblemImpact": "{ProblemImpact}",
  "ProblemURL": "https://YOUR_DYNATRACE_HOST/#problems/problemdetails;pid={ProblemID}"
}
```

Use the placeholders shown as available by your Dynatrace tenant. Keep `ProblemID`, `ProblemTitle`, and `State`; they control correlation, title, and lifecycle. Assign the intended alerting profile, send a test notification, and save.

Do not enable **Accept any SSL certificate**. If the setting exists in your tenant, **Secret webhook URL** only hides the URL in Dynatrace's UI; it does not replace OpsKnight authentication or add the generic HMAC header.

## Mapping contract

| Dynatrace value                                         | OpsKnight behavior            |
| ------------------------------------------------------- | ----------------------------- |
| `State: OPEN` or another non-recovery value             | Trigger                       |
| `State: RESOLVED`, `CLOSED`, `RECOVERED`, `OK`, or `UP` | Resolve                       |
| State containing `ACK`/`ACKNOWLEDGE`                    | Acknowledge an existing match |

The deduplication key is `ProblemID`. If it is absent, the adapter falls back to a normalized `ProblemTitle`; title changes can then prevent resolution.

The incident summary uses `ProblemTitle`, falling back to `ProblemDetailsText`. Severity is normalized from `SeverityLevel` then `ProblemImpact`, with warning as the fallback. Common impact values might not express urgency, so configure the service's urgency rules rather than assuming a particular page priority.

## Validate end to end

1. Send Dynatrace's test notification and confirm HTTP `202`.
2. Open a controlled problem and confirm one OpsKnight incident appears on the intended service.
3. Record the problem ID and OpsKnight deduplication key.
4. Close the Dynatrace problem.
5. Confirm the resolve notification has the same `ProblemID` and resolves the same OpsKnight incident.
6. Verify schedule, escalation, and outbound delivery separately.

## Troubleshooting

**Dynatrace receives `401`**

Confirm the URL includes the current integration key. If the OpsKnight integration has a signing secret, remove it for direct delivery or use a compatible bridge.

**Dynatrace receives `400`**

Validate that the rendered custom payload is JSON. A placeholder that emits raw quotes or invalid JSON can break parsing; use Dynatrace's test preview.

**Opening and recovery create different results**

Compare `ProblemID` in both raw deliveries. Do not generate a new ID, use problem event IDs, or derive the key from changing text.

**Severity is unexpected**

Include a supported `SeverityLevel` value if your tenant exposes one, or map incident urgency in the OpsKnight service. `ProblemImpact` alone can fall back to warning.

**No incident is created**

Confirm the alerting profile matches the problem and the integration is enabled. Review Dynatrace notification history, OpsKnight system logs, and the service's event log.

## Related topics

- [Dynatrace custom webhook documentation](https://docs.dynatrace.com/docs/analyze-explore-automate/notifications-and-alerting/problem-notifications/webhook-integration)
- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
