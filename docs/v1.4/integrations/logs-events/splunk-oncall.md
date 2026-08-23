---
order: 2
title: Splunk On-Call migration
description: Forward Splunk On-Call incident lifecycle events into OpsKnight with explicit payload and correlation rules
---

# Splunk On-Call migration

Use Splunk On-Call custom outbound webhooks to mirror incident trigger, acknowledgment, and resolution into an OpsKnight service during migration. This is one-way ingest; OpsKnight actions are not sent back to Splunk On-Call by this integration.

## Before you begin

Splunk On-Call outbound webhooks require the applicable product entitlement and admin credentials. Decide which routing key/team maps to each OpsKnight service and test on a non-production incident first.

## Create the OpsKnight integration

1. In OpsKnight, open **Services**, select the target service, and open **Integrations**.
2. Add **Splunk On-Call**.
3. Copy the complete URL:

```text
https://OPSKNIGHT_HOST/api/integrations/splunk-oncall?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

The URL contains a credential. Create a separate integration for each service mapping instead of sharing one URL across unrelated teams.

## Configure three outbound webhooks

In Splunk On-Call, open **Integrations → Outgoing Webhooks → Add Webhook**. Create one `POST`, `application/json` webhook for each event:

| Splunk event            | Static `status` in payload | OpsKnight action |
| ----------------------- | -------------------------- | ---------------- |
| `Incident-Triggered`    | `triggered`                | Trigger          |
| `Incident-Acknowledged` | `acknowledged`             | Acknowledge      |
| `Incident-Resolved`     | `resolved`                 | Resolve          |

Use the same complete URL and same identifier fields in all three. A payload template can follow this shape:

```json
{
  "entity_id": "${{ALERT.entity_id}}",
  "entity_display_name": "${{ALERT.entity_display_name}}",
  "state_message": "${{ALERT.state_message}}",
  "message_type": "${{ALERT.message_type}}",
  "status": "triggered"
}
```

Change only the static `status` for the acknowledgment and resolution webhooks. Splunk lists variables available for the selected event; if a listed field name differs in your tenant, map an equivalent stable ID and title. Preview the rendered JSON—do not leave unresolved `${{…}}` text.

If one `Any-Incident` webhook can emit a normalized `status` value for every lifecycle event in your tenant, it can replace the three-webhook design, but validate all three actions before production use.

## Correlation and mapping

The adapter selects the key in this order:

1. `incident_id`;
2. `entity_id`;
3. `alert.id`; or
4. normalized `entity_display_name`.

Do not include a sometimes-empty higher-priority ID. Trigger, acknowledge, and resolve must choose the same first populated field.

Summary uses `message`, state message, entity display name, then nested alert message. Severity is normalized from top-level severity, `message_type`, or nested alert severity and defaults to warning. Final incident urgency follows the OpsKnight service rules.

## Request security

OpsKnight always validates the integration key. The optional generic signing secret requires an unprefixed raw-body HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`.

Splunk On-Call lets administrators add custom headers, but it does not automatically turn an arbitrary header into that digest. Leave the OpsKnight signing secret unset for a direct connection unless a compatible signature value can be generated. For stronger verification, send through a gateway that authenticates the Splunk request and signs the forwarded body.

## Validate the migration path

1. Trigger a disposable Splunk On-Call incident and confirm the webhook receives HTTP `202`.
2. Confirm one incident appears on the mapped OpsKnight service and record its selected key.
3. Acknowledge it in Splunk On-Call; confirm the same OpsKnight incident acknowledges.
4. Resolve it in Splunk On-Call; confirm the same OpsKnight incident resolves.
5. Reopen/retrigger according to your migration policy and confirm the expected correlation.
6. Separately verify that OpsKnight pages the intended responder.

Run both systems in parallel until trigger, acknowledgment, resolution, routing, and outbound notification evidence is complete. Avoid double-paging users unless that is an explicit migration test.

## Troubleshooting

**Splunk receives `401`**

Confirm all three webhooks use the complete current URL. If an OpsKnight signing secret exists, use a compatible gateway or remove it for direct delivery.

**Acknowledgment or resolution creates another result**

Compare the first populated identifier among `incident_id`, `entity_id`, and `alert.id`. It must be identical across every payload.

**Everything triggers**

The payload probably omits `status` or sends an unrecognized value. Use the static `acknowledged` and `resolved` values shown above; `message_type: CRITICAL` describes severity, not lifecycle.

**No event is sent**

Confirm the webhook subscription type, product entitlement, admin configuration, and any Rules Engine condition. Splunk notes that webhook configuration changes can take time to propagate.

**OpsKnight returns `429`**

The default is 100 requests per 60 seconds per integration. Honor retry/reset headers and split unrelated routing domains into separate integrations.

## Related topics

- [Splunk On-Call custom outbound webhooks](https://help.splunk.com/en/splunk-cloud-platform/alert-and-respond/splunk-on-call/introduction-to-splunk-on-call/custom-outbound-webhooks-in-splunk-on-call)
- [Inbound webhook reference](../inbound-webhook-reference)
- [PagerDuty Events API v2 compatibility](../custom/pagerduty-emulation)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
