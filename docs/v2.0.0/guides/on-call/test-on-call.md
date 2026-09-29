---
title: Test an on-call route
description: Trigger a controlled incident and verify schedule resolution, escalation target, notification delivery, and responder action.
type: how-to
product_area: on-call
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Test and verify an on-call route end to end.
verification:
  level: test
  verified_at: 2026-09-29
  evidence: [tests/integration/schedule-assignment-concurrency.test.ts, src/lib/escalation/]
---

# Test an on-call route

## Before you begin

Use a non-production test service or approved window. Ensure it references an escalation policy targeting the schedule, the current responder expects the test, and at least one personal notification endpoint is enabled.

## Open the feature

Open **Schedules → select schedule** to record current on-call, then open the test service and its escalation policy.

## Configure the test

Confirm expected current responder, first policy step/delay/channel, service notification settings, and a unique test title. Avoid paging production responders unexpectedly.

## Complete the action

1. Create/ingest the controlled incident.
2. Observe policy/schedule target resolution.
3. Wait for the intended notification.
4. Have the responder acknowledge through the intended channel.
5. Resolve with a test summary.

## What OpsKnight does

At execution time OpsKnight resolves the schedule's effective on-call, creates delivery work for eligible endpoints, and records escalation/delivery/lifecycle results. The schedule preview alone does not prove delivery.

## Verify it worked

Confirm expected responder, channel, delivery result, acknowledgement actor/time, escalation stop/advance behavior, and resolved timeline. Inspect delivery history and queue/provider health for objective evidence.

## Change or undo the test

Resolve the test incident, label/note it clearly, and remove temporary overrides/destinations/service changes. Keep evidence without leaving production routing altered.

## Troubleshooting

**Wrong responder:** inspect test timestamp, schedule zone/layers/overrides and policy target.

**Right responder but no delivery:** inspect preferences, endpoint usability, provider configuration, delivery history, retries, and queue health.

## Next steps

- [Configure escalation policy](../escalation/create-policy)
- [Inspect notification delivery](../notifications/inspect-delivery)

