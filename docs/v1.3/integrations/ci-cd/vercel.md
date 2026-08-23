---
order: 4
title: Vercel
description: Trigger and resolve OpsKnight incidents from production and preview Vercel deployment events.
---

# Vercel integration

The Vercel adapter accepts deployment webhooks for one OpsKnight service. Known failure events trigger incidents, ready/succeeded events resolve a matching incident, and created/canceled events provide non-triggering lifecycle updates.

## Configure OpsKnight

1. Go to **Services → select a service → Integrations**.
2. Add a **Vercel** integration.
3. Copy its integration ID and integration key.
4. If you will use Vercel request signing, configure a separate signature secret on the integration.

## Configure Vercel

Create the webhook in the intended Vercel project/team and use:

```text
https://ops.example.com/api/integrations/vercel?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

Subscribe to the deployment error/failed, ready/succeeded, created, and canceled events you need. The integration key is always required. Because a query key can appear in provider/proxy logs, treat the complete URL as a secret; use `X-Integration-Key` instead if your sender configuration can add it.

When an OpsKnight signature secret is configured, the request must include `X-Vercel-Signature` containing the raw hexadecimal HMAC-SHA1 of the exact request body. The header has no `sha1=` prefix. Configure the same secret at Vercel and OpsKnight, or leave the OpsKnight signature secret empty until signing is available.

## Event mapping

Matching is case-insensitive and recognizes event-type text containing:

| Vercel event text                            | OpsKnight action | Normalized severity                      |
| -------------------------------------------- | ---------------- | ---------------------------------------- |
| `deployment.error` or `deployment.failed`    | Trigger          | `critical` production; `error` otherwise |
| `deployment.succeeded` or `deployment.ready` | Resolve          | `info`                                   |
| `deployment.canceled`                        | Acknowledge      | `warning`                                |
| `deployment.created`                         | Acknowledge      | `info`                                   |
| Any other type                               | Acknowledge      | `info`                                   |

Service urgency mapping determines final incident urgency. A normalized `critical` severity does not by itself guarantee a particular escalation or notification.

## Deduplication boundary

Production events use one key per lower-cased project name and the production target:

```text
vercel-PROJECT-production
```

Therefore, a successful/ready production deployment for the same project can resolve an active production failure even when the deployment ID differs.

Non-production events use project, target, and deployment ID:

```text
vercel-PROJECT-TARGET-DEPLOYMENT_ID
```

A preview/development recovery must retain the same project, target, and deployment ID as its failure. If the deployment ID is absent, the fallback segment is `unknown`, which can correlate otherwise unrelated non-production events; ensure Vercel supplies deployment IDs.

## Test the lifecycle

Use Vercel's delivery/test view when available, then confirm the incident in OpsKnight. For a direct unsigned integration test:

```bash
export OPSKNIGHT_URL="https://ops.example.com"
export INTEGRATION_ID="replace-me"
export INTEGRATION_KEY="replace-me"

curl --fail-with-body \
  --request POST \
  "${OPSKNIGHT_URL}/api/integrations/vercel?integrationId=${INTEGRATION_ID}" \
  --header "Content-Type: application/json" \
  --header "X-Integration-Key: ${INTEGRATION_KEY}" \
  --data '{
    "type": "deployment.error",
    "payload": {
      "project": { "name": "payments-web" },
      "deployment": { "id": "dpl_synthetic_001", "name": "payments-web" },
      "target": "production",
      "error": { "code": "SYNTHETIC", "message": "Controlled test" }
    }
  }'
```

Send the same project/target with `"type": "deployment.ready"`. Confirm the failure creates/updates the intended service incident and ready resolves that same incident. If a signature secret exists, perform the test through Vercel or calculate `X-Vercel-Signature` over the exact raw bytes sent.

Accepted requests normally return HTTP 202.

## Troubleshooting

| Symptom                                  | Check                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 401 missing/invalid signature            | HMAC-SHA1, exact raw body, hexadecimal output, no prefix, and the same Vercel/OpsKnight secret.      |
| Production recovery does not resolve     | Both payloads use the same project name and `target=production`.                                     |
| Preview recovery does not resolve        | Project, target, and deployment ID are identical to the failure.                                     |
| Canceled deployment does not page        | Expected: canceled maps to acknowledge, not trigger.                                                 |
| Preview incidents correlate unexpectedly | The deployment ID is missing and therefore uses `unknown`; correct the Vercel payload.               |
| 429 rate limited                         | Honor `Retry-After` and investigate retry storms or unexpected projects sharing the integration.     |
| Incident exists but delivery is absent   | Inspect escalation targets, notification history, provider configuration, and the incident timeline. |

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [How integrations work](../../core-concepts/integrations)
- [Webhook verification](../../security/webhook-verification)
- [API rate limiting](../../api/rate-limiting)
- [Troubleshooting](../../troubleshooting)
