---
order: 2
title: Bitbucket Pipelines
description: Send Bitbucket repository build status and normalized pipeline events to OpsKnight with exact v1.4 limits
---

# Bitbucket Pipelines

Use the Bitbucket endpoint to create incidents from repository build-status deliveries or from an intermediary that emits OpsKnight's normalized pipeline shape.

## Before you begin

You need Admin access to the OpsKnight service, repository Admin access in Bitbucket Cloud, and a public HTTPS OpsKnight endpoint.

## Create and connect the integration

1. In OpsKnight, open **Services**, select the service, and open **Integrations**.
2. Add a **Bitbucket** integration and copy its complete webhook URL:

```text
https://OPSKNIGHT_HOST/api/integrations/bitbucket?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

3. In Bitbucket, open the repository's **Settings → Webhooks → Add webhook**.
4. Paste the complete URL, keep certificate verification enabled, and select **Build status created** and **Build status updated**.
5. Save the webhook and deliver a controlled failed build status.

The `integrationKey` in the URL is required and is a credential. Do not put the URL in tickets, screenshots, or public logs.

## Important v1.4 boundaries

### Native signature mismatch

Bitbucket Cloud signs a configured webhook secret in `X-Hub-Signature` with a `sha256=` prefix. OpsKnight v1.4's generic verifier expects an unprefixed HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`. These contracts are not directly compatible.

For a direct Bitbucket connection, do **not** set an OpsKnight signing secret; rely on the unguessable integration key, HTTPS, network controls, and key rotation. If your policy requires signed delivery, place a trusted gateway in front of OpsKnight that validates Bitbucket's signature and then sends OpsKnight's generic signature contract.

### Native recovery mapping

Native build-status webhooks put state under `commit_status.state`. The v1.4 adapter uses that payload for the stable status name but does not use `commit_status.state` to choose resolve. A native successful build-status delivery therefore does not reliably auto-resolve the incident.

Use one of these operating models:

- resolve the incident manually after verifying recovery;
- send failures through the Bitbucket webhook and recovery through the [Events API](../../api/events) with a controlled shared deduplication key; or
- use an intermediary that emits the normalized pipeline payload below and validates both trigger and resolve end to end.

Do not advertise Bitbucket auto-resolution until this limitation changes in the application.

## Correlation behavior

The integration key is built from:

- repository `full_name`, falling back to repository `name`; plus
- `commit_status.name`, when present.

It is lowercased and spaces become hyphens. Commit SHA, pipeline UUID, and build number are not part of the key. Two differently named build statuses for one repository create separate correlations; repeated status names share one.

For the normalized pipeline shape, a result containing `success`, or a state containing both `completed` and `successful`, resolves. Every other value triggers. The normalizer does not create an acknowledge action.

## Controlled normalized test

First send a failure:

```bash
curl --fail-with-body --request POST \
  "https://OPSKNIGHT_HOST/api/integrations/bitbucket?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "repository": {"full_name": "example/payments"},
    "pipeline": {
      "uuid": "pipeline-101",
      "build_number": 101,
      "state": {"name": "COMPLETED", "result": {"name": "FAILED"}}
    }
  }'
```

Then change the UUID/build number and send `"name": "SUCCESSFUL"`. Confirm the original incident resolves because repository—not pipeline run—is the normalized correlation key.

## Validate in production

1. Confirm Bitbucket records HTTP `202` for the failure delivery.
2. Confirm exactly one incident appears on the intended OpsKnight service.
3. Record the derived key and the source payload.
4. Exercise the chosen recovery model.
5. Confirm recovery changes that same incident rather than creating another.
6. Verify the service's urgency rules and paging path separately.

## Troubleshooting

**Bitbucket receives `401`**

Confirm the URL contains the current `integrationKey`. If OpsKnight has a signing secret, remove it for direct delivery or send through a compatible signature gateway.

**Bitbucket receives `400`**

Confirm the request is JSON and contains an object. For a normalized pipeline, `build_number` must be numeric when supplied.

**A successful build did not resolve**

This is the documented native payload boundary above. Use the chosen manual, Events API, or intermediary recovery model.

**Multiple builds collapse into one incident**

The repository and optional status name—not SHA or build number—control correlation. Use distinct `commit_status.name` values or the Events API if you require another grouping model.

**Bitbucket receives `429`**

The default integration limit is 100 requests per 60 seconds per integration. Honor reset/retry headers and reduce unnecessary subscriptions.

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [Events API](../../api/events)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
