---
title: Test notification delivery
description: Verify provider, endpoint, routing, queue, and recipient behavior with a controlled notification and synthetic incident.
type: how-to
product_area: notifications
audience: [administrator, operator, responder]
reader:
  status: READER_COMPLETE
  task: Test and verify notification delivery end to end.
verification:
  level: test
  verified_at: 2026-09-29
  evidence: [tests/integration/notification-flow.test.ts, tests/integration/notification-policy-outcomes.test.ts]
---

# Test notification delivery

## Before you begin

Configure provider, route, recipient endpoint/preferences, and a non-production service or approved window. Tell the test recipient and choose a unique title/time.

## Open the feature

Use **Settings → Notifications** for provider test, then the test service/incident workflow for end-to-end routing.

## Configure the test

Record expected event, recipient, channel, provider, endpoint, policy step/timing, quiet-hours effect, and success evidence.

## Complete the action

1. Send the provider-level test and confirm receipt/history.
2. Trigger a synthetic incident on the test service.
3. Wait for intended route/escalation delivery.
4. Acknowledge through the intended response path.
5. Resolve and label it as a test.

## What OpsKnight does

Provider test checks base transport; synthetic incident checks intent, recipient/endpoint eligibility, scheduling/queue, provider admission/attempt, feedback, and lifecycle suppression.

## Verify it worked

Confirm one logical intent, correct recipient/channel/provider, attempt/outcome/provider ID, actual receipt, acknowledgement attribution, and no unintended later escalation.

## Change or undo the test

Resolve the test, remove temporary routing/overrides/endpoints, and retain sanitized evidence. Communicate accidental pages.

## Troubleshooting

**Provider test passes but incident fails:** trace service/policy target, user preference/endpoint, event eligibility, queue, and state suppression.

**Duplicate delivery:** inspect stable intent/delivery IDs, provider retry, repeated manual test, and policy duplication before retrying.

## Next steps

- [Inspect delivery](./inspect-delivery)
- [Retry failures](./retry-failures)

