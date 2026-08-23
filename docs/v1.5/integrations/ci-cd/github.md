---
order: 1
title: GitHub Actions
description: Send GitHub workflow and check state changes to OpsKnight with exact correlation, signature, and recovery behavior
---

# GitHub Actions

Use the native GitHub endpoint to open, acknowledge, and resolve OpsKnight incidents from workflow runs and check runs. The integration is scoped to the OpsKnight service on which you create it.

## Before you begin

You need:

- Admin access to the OpsKnight service;
- repository Admin access in GitHub;
- an HTTPS OpsKnight URL reachable by GitHub; and
- a workflow or check that can be failed safely for end-to-end testing.

## Create the integration

1. In OpsKnight, open **Services**, select the service, and open **Integrations**.
2. Add a **GitHub** integration.
3. Copy the generated webhook URL. It has this shape:

```text
https://OPSKNIGHT_HOST/api/integrations/github?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

4. Generate a signing secret and copy it once. Treat both the URL and secret as credentials.

Do not remove `integrationId` or `integrationKey`. OpsKnight validates the integration key even when signature verification is enabled.

## Configure GitHub

In the repository, open **Settings → Webhooks → Add webhook** and set:

| GitHub field | Value                                   |
| ------------ | --------------------------------------- |
| Payload URL  | The complete OpsKnight webhook URL      |
| Content type | `application/json`                      |
| Secret       | The OpsKnight signing secret            |
| Events       | **Workflow runs** and/or **Check runs** |
| Active       | Enabled                                 |

Subscribe only to the event types you use. The endpoint accepts a GitHub JSON body; form-encoded `payload=` delivery is not supported.

GitHub sends `X-Hub-Signature-256: sha256=…`. If an OpsKnight signing secret exists and `INTEGRATION_VERIFY_SIGNATURES` has not been disabled, a missing or invalid signature is rejected with `401`.

## State and correlation contract

### Workflow runs

| GitHub state                                         | OpsKnight action                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `queued`, `requested`, or `in_progress`              | Acknowledge the matching incident if one exists; do not create a new incident |
| `completed` + `failure`, `cancelled`, or `timed_out` | Trigger                                                                       |
| `completed` + `success`                              | Resolve                                                                       |

Workflow correlation uses repository full name + workflow name + optional head branch, normalized to lowercase. It deliberately does **not** use the run ID. A later successful run resolves an earlier failure only when repository, workflow name, and branch produce the same key.

Renaming a workflow, changing the branch, or omitting `head_branch` changes the key. Resolve the old incident manually if the success event cannot match it.

### Check runs

| GitHub state                                         | OpsKnight action                                |
| ---------------------------------------------------- | ----------------------------------------------- |
| `queued` or `in_progress`                            | Acknowledge the matching incident if one exists |
| `completed` + `failure`, `cancelled`, or `timed_out` | Trigger                                         |
| `completed` + `success`                              | Resolve                                         |

Check correlation uses repository full name + check name. The run ID is retained as incident context, but is not part of the key.

### Deployment payload boundary

The v1.4 transformer can process a normalized `deployment` object containing `id`, `environment`, and `state`, with the deployment ID as its key. GitHub's native `deployment_status` payload places state in a separate `deployment_status` object, so do not select native deployment-status events and assume they are supported. Use workflow/check events, the [Events API](../../api/events), or a tested intermediary that emits the normalized shape.

Other GitHub event types fall back to an acknowledge event keyed to the repository. They are not feature-specific incident integrations.

## Test the integration

1. Save the GitHub webhook and confirm its initial delivery receives a response.
2. Run a controlled workflow or check that fails.
3. Confirm GitHub records HTTP `202` and OpsKnight creates one incident on the intended service.
4. Capture its deduplication key from the incident/event detail.
5. Rerun the same workflow/check successfully on the same branch.
6. Confirm the same incident resolves and no second incident is created.

GitHub's **Recent deliveries** view can redeliver an unchanged payload. Redelivery tests deduplication, but redelivering an old failure after recovery can trigger the correlated incident again. Use a disposable service or resolve it afterward.

## Controlled request

This request tests parsing and incident creation but is not signed like GitHub. Use it only when the OpsKnight integration has no signing secret, or generate the correct HMAC over the exact body and send `X-Hub-Signature-256`.

```bash
curl --fail-with-body --request POST \
  "https://OPSKNIGHT_HOST/api/integrations/github?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "action": "completed",
    "repository": {
      "name": "payments",
      "full_name": "example/payments",
      "html_url": "https://github.com/example/payments"
    },
    "workflow_run": {
      "id": 1001,
      "name": "Production checks",
      "head_branch": "main",
      "status": "completed",
      "conclusion": "failure",
      "html_url": "https://github.com/example/payments/actions/runs/1001"
    }
  }'
```

## Troubleshooting

**GitHub receives `401`**

Confirm the URL still contains the current integration key. If a signing secret is configured, confirm GitHub uses the same secret and sends `X-Hub-Signature-256`. Do not copy the `sha256=` digest into the secret field.

**GitHub receives `400`**

Use JSON content type and inspect the response body. Unsupported conclusions or a native deployment-status payload do not match the v1.4 schema.

**GitHub receives `429`**

The default integration limit is 100 requests per 60 seconds per integration. Honor the reset/retry headers and reduce event subscriptions or delivery bursts.

**A success did not resolve a failure**

Compare repository full name, workflow/check name, and workflow branch between the two deliveries. Those fields—not run ID—control correlation.

**No one was paged**

Confirm the incident was created on the expected service, then verify service urgency rules, escalation policy, schedule coverage, user notification preferences, and provider delivery history. A received webhook does not by itself prove outbound paging.

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Events API](../../api/events)
- [Troubleshooting](../../troubleshooting)
