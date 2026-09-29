---
title: Troubleshoot escalation policies
description: Diagnose missing targets, wrong recipients, timing, duplicate pages, non-advancement, and acknowledgement suppression failures.
type: troubleshooting
product_area: escalation
audience: [administrator, responder, operator]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover a failed escalation route.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/escalation/, src/lib/notification-delivery.ts]
---

# Troubleshoot escalation policies

## No recipient is resolved

Check service policy attachment, active incident/current generation, target existence, team membership/lead mode, schedule coverage/override, user status, and personal endpoint eligibility. Correct the target and run a controlled test.

## Wrong responder is paged

Check incident service/policy, execution timestamp, schedule zone/overrides, team membership, and recorded target resolution. Communicate accidental paging and correct the narrow source.

## Next step is late or never advances

Check incident remains open/unacknowledged, configured cumulative timing, scheduler heartbeat/lag, queue oldest age, database, provider retries, and worker health.

## Acknowledgement does not stop later work

Check acknowledgement time/state, concurrent step claim, incident/policy generation, and delivery already emitted before acknowledgement. An already sent provider notification cannot be recalled.

## Duplicate notifications occur

Check provider retry/idempotency, repeated manual escalation, duplicated targets across steps, concurrent workers, and projection/delivery operation IDs before retrying.

## Recovery verification

Use [Test an escalation policy](./test-policy) and confirm target, delivery, timing, acknowledgement behavior, fallback, and resolution evidence.

