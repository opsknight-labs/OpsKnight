---
title: Author and operate automation through the API
description: Create a complete service automation draft, validate and simulate it, publish to Shadow, and promote a Live candidate with safe preconditions.
type: how-to
product_area: services
audience: [administrator, developer, operator]
verification:
  level: source
  verified_at: 2026-10-28
  evidence:
    - src/lib/automation/contract.ts
    - src/lib/automation/authoring-contract.ts
    - src/lib/automation/versioning.ts
    - src/app/api/v2/services/[id]/automation/draft/route.ts
    - src/app/api/v2/services/[id]/automation/publish/route.ts
    - src/app/api/v2/services/[id]/automation/mode/route.ts
    - src/app/api/v2/services/[id]/automation/candidate/route.ts
    - src/app/api/v2/services/[id]/automation/candidates/activate/route.ts
    - tests/integration/api-v2-automation-lifecycle.test.ts
---

# Author and operate automation through the API

This walkthrough implements the same example as the [UI guide](./service-automation).
Use a test service first.

## Prerequisites

This walkthrough requires an administrator-owned API key with
`automation:read`, `automation:write`, and `automation:publish`; reading incident
decisions also needs `incidents:read`. A responder with write scope can prepare
an owning-team draft but cannot publish or enable Live.

Use [Bearer API authentication](../../reference/api/authentication). Set
`OPSKNIGHT_URL`, `OPSKNIGHT_SERVICE_ID`, and `OPSKNIGHT_API_KEY` in your client
session. Obtain the service ID from the service resource; use actual returned IDs
for versions and destinations. Keep the key out of saved payload files.

Follow these stages in order:

1. Read the current configuration and draft.
2. Prepare, validate, simulate, and save a complete snapshot.
3. Publish and observe in Shadow before enabling Live.
4. Review and activate candidates for later changes.
5. Restore a reviewed version or disable automation when necessary.

## 1. Read configuration and draft

```sh
curl --fail-with-body -sS -i \
  -H "Authorization: Bearer ${OPSKNIGHT_API_KEY}" \
  "${OPSKNIGHT_URL}/api/v2/services/${OPSKNIGHT_SERVICE_ID}/automation"

curl --fail-with-body -sS -i \
  -H "Authorization: Bearer ${OPSKNIGHT_API_KEY}" \
  "${OPSKNIGHT_URL}/api/v2/services/${OPSKNIGHT_SERVICE_ID}/automation/draft"
```

Record the configuration ETag, `activeVersionId`, `candidateVersionId`, and the
**separate draft ETag**. If no draft exists, GET draft returns an empty snapshot
at revision zero. Do not replace a draft containing another operator's work
without reviewing it.

## 2. Prepare the complete snapshot

Save the following request body as `automation-draft.json`. It contains all fields
and rules for this example; PUT replaces the draft rather than appending rules.
The final catch-all preserves default routing for missing or unknown environments.

```json
{
  "snapshot": {
    "schemaVersion": 1,
    "fields": [
      {
        "fieldId": "environment",
        "key": "environment",
        "label": "Environment",
        "type": "ENUM",
        "caseSensitive": false,
        "allowedValues": ["production", "staging", "development"],
        "aliases": {
          "prd": "production",
          "prod": "production",
          "stg": "staging"
        },
        "mappings": [
          {
            "source": "EVENT",
            "path": "payload.custom_details.environment"
          }
        ]
      }
    ],
    "rules": [
      {
        "id": "production-priority",
        "name": "Production priority",
        "phase": "ENRICH",
        "enabled": true,
        "conditions": [
          {
            "fieldKey": "environment",
            "operator": "EQ",
            "value": "production"
          }
        ],
        "actions": [
          {
            "type": "SET_PRIORITY",
            "value": "P1"
          },
          {
            "type": "ADD_TAG",
            "value": "production"
          }
        ]
      },
      {
        "id": "known-non-production",
        "name": "Known non-production",
        "phase": "ROUTE",
        "enabled": true,
        "conditions": [
          {
            "fieldKey": "environment",
            "operator": "IN",
            "value": ["staging", "development"]
          }
        ],
        "actions": [
          {
            "type": "NO_ESCALATION"
          }
        ]
      },
      {
        "id": "default-response",
        "name": "Default response",
        "phase": "ROUTE",
        "enabled": true,
        "conditions": [],
        "actions": [
          {
            "type": "USE_SERVICE_DEFAULT"
          }
        ]
      }
    ]
  }
}
```

## 3. Validate, simulate, and save

POST the same `automation-draft.json` body to
`/api/v2/services/{id}/automation/validate`. Review both blocking errors and
warnings. For `/simulate`, use a body containing the same `snapshot`, an `event`
from the [UI example](./service-automation#4-test-the-draft-without-sending-notifications),
`integrationType`, and optional service-owned `integrationId`, `providerPayload`,
and ISO `evaluationAt`. Use the integration's actual type; built-in `integration`
conditions and type-restricted mappings depend on it.

Simulation does not ingest an alert or prove provider delivery. Its public result
includes priority, safe tags, route, context states, and condition truth values,
with source/custom context values redacted. Test production, staging, missing,
and unmapped values before saving.

Set `OPSKNIGHT_DRAFT_ETAG` to the exact draft ETag, including its quotes, and
`OPSKNIGHT_REQUEST_KEY` to a new unique identifier for this logical save:

```sh
curl --fail-with-body -sS -i -X PUT \
  -H "Authorization: Bearer ${OPSKNIGHT_API_KEY}" \
  -H 'Content-Type: application/json' \
  -H "If-Match: ${OPSKNIGHT_DRAFT_ETAG}" \
  -H "Idempotency-Key: ${OPSKNIGHT_REQUEST_KEY}" \
  --data-binary @automation-draft.json \
  "${OPSKNIGHT_URL}/api/v2/services/${OPSKNIGHT_SERVICE_ID}/automation/draft"
```

Retain the updated draft ETag from the successful response. For transport retries
of the same operation, reuse the same idempotency key and identical request.
Use a new key for a different operation or changed payload. On 412, refetch the
resource and reconcile rather than simply retrying with a newer ETag.

## 4. Publish and enable Shadow

POST `/api/v2/services/{id}/automation/publish` with the updated draft ETag,
a fresh idempotency key, and this body for a service with no active version:

```json
{ "expectedActiveVersionId": null }
```

For an existing service, supply its actual active version ID. While Live, include
`expectedCandidateVersionId` as well; an existing candidate cannot be replaced
without its expected identity. Publication returns immutable version identity,
not an ETag for the next draft write.

GET configuration again. Using its new **configuration ETag**, PATCH
`/api/v2/services/{id}/automation/mode` with a fresh idempotency key and:

```json
{ "mode": "SHADOW", "expectedActiveVersionId": "REPLACE_WITH_PUBLISHED_VERSION_ID" }
```

Global automation must already be enabled by an administrator. Use the system
settings UI, or the separately authorized `/api/v2/settings/automation` endpoint;
the API requires the separate `automation-settings:read` /
`automation-settings:write` scopes and administrator privileges.

## 5. Verify ingestion and enable Live

Send representative alerts through the service's configured integration, using
unique deduplication keys. Query `/automation` for effective mode and health and
`/automation/decisions` for incident-scoped decisions. Read
`/automation/observations` for discovery metadata; the public API does not return
raw previews or hashes. Use cursor pagination for bounded lists.

Once reviewed, GET configuration again and PATCH `/automation/mode` to `LIVE`,
using its ETag, a new idempotency key, and the actual active version ID. Explicit
acknowledgement flags are available for absent Shadow evidence or recorded errors;
review the reason before accepting those exceptions. Confirm real priority,
responder routing, SLA capture, and notifications as described in the UI guide.

## 6. Publish and promote a candidate

Save and publish a changed draft while Live. The response identifies the candidate;
the existing active version continues routing. GET `/automation/candidate` for its
snapshot, comparison aggregates, readiness policy/results, and pending-work sample.

After reviewing evidence, POST `/automation/candidates/activate` with a fresh
idempotency key and:

```json
{
  "expectedCandidateVersionId": "REPLACE_WITH_REVIEWED_CANDIDATE_ID",
  "expectedActiveVersionId": "REPLACE_WITH_REVIEWED_ACTIVE_ID",
  "expectedReadinessPolicyRevision": 0
}
```

Replace the policy revision with `readiness.settingsRevision` from the review.
This route uses version/policy preconditions in the body; it does not require
`If-Match`. If necessary, explicitly supply `acknowledgeNoShadow`,
`acknowledgeShadowErrors`, or `acknowledgeMaterialDifferences` after review.
A backlog above policy remains blocking. See [readiness details](../../reference/service-automation#version-lifecycle-and-readiness).

Alternatively, DELETE `/automation/candidate` with a fresh idempotency key and
`{ "expectedCandidateVersionId": "REPLACE_WITH_CANDIDATE_ID" }` to discard it.

## 7. Restore or disable

GET `/automation/versions` and `/automation/versions/{versionId}` to review history.
POST `/automation/restore` with `{ "sourceVersionId": "REPLACE_WITH_VERSION_ID" }`,
the current **draft ETag**, and a fresh idempotency key. Restore only creates an
editable draft; publish and, when Live, promote the resulting candidate explicitly.

PATCH mode to `DISABLED` with the current configuration ETag and active version ID
to stop newly accepted service automation. For enabled accepted backlog too, use
the administrator global emergency switch. Neither action rewrites existing
incident decisions or recalls already queued provider delivery.

See the [API contract](../../reference/api/v2#service-automation-drafts-and-publication)
for response envelopes, scopes, errors, and retry behavior.
