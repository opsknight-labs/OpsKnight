---
title: Troubleshoot on-call schedules
description: Diagnose empty coverage, wrong responders, time-zone or handoff errors, override conflicts, and paging mismatches.
type: troubleshooting
product_area: on-call
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover an incorrect on-call schedule or route.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/schedules/, src/lib/escalation/]
---

# Troubleshoot on-call schedules

## No responder is on call

Check active layers, coverage restrictions, responder membership/status, time zone, and timestamp. Add/correct recurring coverage or a bounded override, then verify current and future preview and run a controlled route test.

## Wrong responder is on call

Check responder order, rotation start, handoff interval, DST/time zone, overlapping layers, and active overrides. Correct the narrow cause, then inspect timestamps before/after the boundary.

## Handoff occurs at wrong time

Confirm the schedule's IANA zone rather than browser/operator local time, layer start, interval, and DST transition. Avoid fixed UTC assumptions for local-time schedules.

## Override does not apply or overlaps

Check start/end ordering, target/replacement eligibility, schedule zone versus stored UTC boundaries, and other overrides. Remove/replace conflicting override and verify inside/outside window.

## Schedule preview is correct but paging is wrong

Inspect escalation policy attachment/step, test incident timestamp, target resolution evidence, notification preferences/endpoints, delivery history, provider, and queue health. Schedule correctness and delivery correctness are separate.

## Recovery verification

Run [Test an on-call route](./test-on-call) and retain schedule target, policy, delivery, acknowledgement, and resolution evidence.

