---
order: 2
title: Pingdom
description: Send Pingdom check down and up notifications to OpsKnight with stable check correlation
---

# Pingdom

Use a Pingdom webhook to trigger an incident when a check is down and resolve it when the same check is up. OpsKnight accepts both JSON and URL-encoded Pingdom-style bodies.

## Create and connect the integration

1. In OpsKnight, open **Services**, select the target service, and open **Integrations**.
2. Add **Pingdom** and copy the complete URL:

```text
https://OPSKNIGHT_HOST/api/integrations/pingdom?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

3. In Pingdom, create a webhook integration with that URL.
4. Assign it to the checks that belong to this OpsKnight service.
5. Save and send a test, then exercise a controlled down/up cycle.

The URL contains the required integration key. Treat it as a secret and rotate the integration if it leaks.

## Payload and lifecycle

The adapter reads these fields:

```json
{
  "check_id": "123456",
  "check_name": "Production checkout",
  "state": "DOWN",
  "message": "Connection refused",
  "description": "HTTPS check",
  "last_error": "Could not connect",
  "time": "2026-08-23T12:00:00Z"
}
```

| `state`                                          | OpsKnight action              | Normalized severity                            |
| ------------------------------------------------ | ----------------------------- | ---------------------------------------------- |
| `DOWN` or another non-recovery value             | Trigger                       | Critical when the value contains `down`        |
| `UP`, `OK`, `RESOLVED`, `CLOSED`, or `RECOVERED` | Resolve                       | Info for `UP`; final urgency rules still apply |
| Value containing `ACK`/`ACKNOWLEDGE`             | Acknowledge an existing match | Based on state                                 |

The key is `check_id`. If it is absent, OpsKnight uses a normalized `check_name`. Keep the same check ID in down and up deliveries.

Summary uses check name, message, then description. Raw payload, last error, and time are retained as incident/event context.

## Request authentication

OpsKnight always validates `integrationKey`. Its optional generic signing contract is an unprefixed raw-body HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`.

Do not configure an OpsKnight signing secret for direct Pingdom delivery unless your Pingdom webhook can send exactly that header contract. Otherwise leave it unset, use HTTPS, restrict access at the edge where possible, and rotate the URL periodically. Use a validating gateway when policy requires signed sender identity.

## Controlled test

With no OpsKnight signing secret configured:

```bash
curl --fail-with-body --request POST \
  "https://OPSKNIGHT_HOST/api/integrations/pingdom?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY" \
  --header "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "check_id=123456" \
  --data-urlencode "check_name=Production checkout" \
  --data-urlencode "state=DOWN" \
  --data-urlencode "last_error=Controlled test failure"
```

Repeat with `state=UP` and confirm the same incident resolves.

## Validate in production

1. Confirm the Pingdom delivery receives HTTP `202`.
2. Confirm the incident is attached to the intended service and uses the expected check ID.
3. Restore the check and confirm the up event resolves the same incident.
4. Confirm service urgency mapping, escalation, schedule, and outbound notification delivery.
5. Record the test time and check ID for future regression testing.

## Troubleshooting

**Pingdom receives `400`**

Confirm the body is JSON or URL-encoded form data. An empty or malformed body is rejected.

**Pingdom receives `401`**

Confirm the complete current URL is configured. If an OpsKnight signing secret exists, remove it for direct delivery or provide the generic signature through a gateway.

**Up does not resolve down**

Compare `check_id` in both deliveries. If one delivery lacks it, the adapter changes to a name-based key and cannot match the ID-based incident.

**The wrong checks share an incident**

Ensure every check has a unique `check_id`. Name-only fallback can collapse checks that share a name.

**OpsKnight returns `429`**

The default is 100 requests per 60 seconds per integration. Honor reset/retry headers and reduce unnecessary check assignments.

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Incidents](../../core-concepts/incidents)
- [Troubleshooting](../../troubleshooting)
