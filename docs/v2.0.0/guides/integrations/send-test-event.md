---
title: Send a test event from the UI
description: Validate an integration key and trigger, acknowledge, and resolve one deduplicated test incident.
type: how-to
product_area: integrations
audience: [administrator, responder]
reader: { status: READER_COMPLETE, task: Send and verify a test event. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/events/test/page.tsx", "src/app/api/events/route.ts"]
---

# Send a test event from the UI

## Before you begin

Create or obtain a service integration key and use a non-production test window. Treat the key as a secret. Choose one unique deduplication key and reuse it for the full trigger/acknowledge/resolve sequence.

## Open the feature

Open **Events → Send Test Alert** (`/events/test`). Get the key from **Services → service → Manage Integrations**.

## Configure and send the event

1. Paste the integration key.
2. Select `trigger`, enter a unique deduplication key, meaningful summary, and severity (`critical`, `error`, `warning`, or `info`).
3. Select **Send Test Alert** and inspect both HTTP status and JSON response.
4. Find the created incident and confirm service, summary, severity mapping, and dedup key.
5. Return to the test UI, keep the same key/dedup key, send `acknowledge`, then `resolve`.

## What OpsKnight does

The UI calls `POST /api/events` with `Authorization: Token token=<integration-key>` and a PagerDuty-style event envelope. Matching dedup keys address the same incident lifecycle; changing the key creates or targets a different correlation.

## Verify the test

Require successful responses for all three actions and one incident whose timeline shows trigger, acknowledgment, and resolution. Review event logs for the request outcome.

## Remove or undo

Resolve the synthetic incident. Rotate the integration key if it was exposed. Test events are operational records and should not be deleted merely to hide a failed test.

## Troubleshooting

- **Integration key required/unauthorized:** copy the correct service key without whitespace and confirm it is active.
- **New incident on every action:** reuse the exact dedup key.
- **Error response:** read the JSON error code/correlation ID and inspect Events/System Logs.

## Next steps

- [Events API](../../reference/api/events)
- [Integration catalog](../../integrations/)
