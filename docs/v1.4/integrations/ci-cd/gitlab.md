---
order: 3
title: GitLab
description: Route GitLab pipeline, job, merge request, deployment, issue, incident, and alert webhooks into OpsKnight.
---

# GitLab integration

The GitLab adapter accepts GitLab.com and self-managed GitLab webhook JSON. It can normalize pipeline/build/job, merge request, deployment, issue, incident, and alert events for one OpsKnight service.

## Before you begin

You need permission to manage the OpsKnight service and the GitLab project webhook. Decide which GitLab events should reach the service; the adapter does not filter refs or environments after receipt.

Create a **GitLab** integration under **Services → select a service → Integrations**. Copy its integration ID and key.

## Configure the webhook

In **GitLab project → Settings → Webhooks**, add:

```text
https://ops.example.com/api/integrations/gitlab?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

The query key is supported for senders that cannot add an authentication header, but the complete URL is a secret and can appear in logs. If your GitLab version supports custom webhook headers, prefer `X-Integration-Key: INTEGRATION_KEY` and omit `integrationKey` from the URL.

Select only the GitLab trigger types you intend to process, such as pipeline, job, merge request, deployment, and issue events. Keep SSL verification enabled.

### Optional GitLab secret token

The integration key and GitLab secret token protect different boundaries:

- the integration key is always required and authorizes/routes the webhook to a service;
- the integration's signature secret, when configured, must also be entered in GitLab's **Secret token** field; GitLab sends it as `X-Gitlab-Token`.

If a signature secret exists, OpsKnight rejects a missing or different `X-Gitlab-Token`. Do not put the integration key in the GitLab **Secret token** field unless it is deliberately also the configured signature secret.

## Event mapping

### Pipelines, builds, and jobs

| GitLab status                                                        | OpsKnight action | Normalized severity |
| -------------------------------------------------------------------- | ---------------- | ------------------- |
| `failed`                                                             | Trigger          | `error`             |
| `success`, `passed`, `manual`                                        | Resolve          | `info`              |
| `running`, `pending`, `created`, `preparing`, `waiting_for_resource` | Acknowledge      | `info`              |
| `canceled`, `skipped`                                                | Acknowledge      | `warning`           |
| Any other value                                                      | Trigger          | `error`             |

When the payload contains `object_attributes.id` or `build_id`, the key is:

```text
gitlab-PROJECT-pipeline-PIPELINE_OR_BUILD_ID
```

A later status update resolves the incident only if it carries the same ID. A successful new pipeline normally has a different ID and therefore does **not** resolve an earlier failed pipeline. When no pipeline/build ID is present, the fallback key uses project plus `ref`, so a later event with that same fallback key can resolve the active incident.

### Other supported GitLab events

| Event kind                | Trigger or update behavior                                          | Recovery behavior             | Deduplication basis   |
| ------------------------- | ------------------------------------------------------------------- | ----------------------------- | --------------------- |
| Merge request             | Open/reopen and other states acknowledge.                           | Merged or closed resolves.    | Project + MR IID/ID   |
| Deployment                | Failed triggers; canceled and unrecognized states acknowledge.      | Success or created resolves.  | Project + environment |
| Issue, incident, or alert | Open/reopen and unrecognized states trigger.                        | Closed/resolved resolves.     | Project + object ID   |
| Other webhook event kinds | Acknowledges an informational event instead of deliberately paging. | No separate recovery mapping. | Project + event kind  |

The adapter records useful GitLab fields plus the raw payload in custom details. Service urgency rules ultimately determine incident urgency; the adapter's normalized severity alone does not guarantee a particular paging outcome.

## Test the lifecycle

Use GitLab's webhook test/delivery view first. For a direct connectivity test, keep one synthetic pipeline ID in both requests:

```bash
export OPSKNIGHT_URL="https://ops.example.com"
export INTEGRATION_ID="replace-me"
export INTEGRATION_KEY="replace-me"

curl --fail-with-body \
  --request POST \
  "${OPSKNIGHT_URL}/api/integrations/gitlab?integrationId=${INTEGRATION_ID}" \
  --header "Content-Type: application/json" \
  --header "X-Integration-Key: ${INTEGRATION_KEY}" \
  --data '{
    "object_kind": "pipeline",
    "project": { "path_with_namespace": "example/payments" },
    "object_attributes": { "id": 42001, "status": "failed" },
    "ref": "main",
    "sha": "0000000000000000000000000000000000000000"
  }'
```

Change only `status` to `success` and send the same payload again. Confirm the first request creates/updates the intended service incident and the second resolves that same incident. If a signature secret is configured, also send `X-Gitlab-Token: SIGNATURE_SECRET`.

Accepted requests normally return HTTP 202. Use a unique synthetic ID when repeating this test later so an old resolved incident is not mistaken for the current result.

## Troubleshooting

| Symptom                                     | Check                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 400 invalid integration key or payload      | Integration ID/key, JSON body, and that numeric GitLab IDs are sent as numbers when present.                           |
| 401 missing/invalid signature               | The configured integration signature secret exactly matches GitLab's **Secret token**.                                 |
| 404 integration not found                   | The URL contains the current integration ID from the intended service.                                                 |
| 429 rate limited                            | Honor `Retry-After`; identify retries or a shared integration receiving unexpected projects.                           |
| Successful pipeline did not resolve failure | Compare the normalized keys. Different pipeline IDs intentionally produce different incidents.                         |
| Event acknowledged instead of triggering    | Check the event kind and status mapping above; merge-request opens and unknown event kinds are intentionally non-page. |
| Wrong service receives the incident         | The integration ID/key belongs to another service; GitLab project identity does not select the service.                |

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [How integrations work](../../core-concepts/integrations)
- [API rate limiting](../../api/rate-limiting)
- [Troubleshooting](../../troubleshooting)
