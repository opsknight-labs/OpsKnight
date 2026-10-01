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

Evaluate the same instant in three forms: stored UTC, schedule-local time, and
the viewer's local time. Use the schedule preview at one minute before, exactly
at, and one minute after the boundary. This exposes interval and DST mistakes
without waiting for the next live handoff.

## Handoff occurs at wrong time

Confirm the schedule's IANA zone rather than browser/operator local time, layer start, interval, and DST transition. Avoid fixed UTC assumptions for local-time schedules.

## Override does not apply or overlaps

Check start/end ordering, target/replacement eligibility, schedule zone versus stored UTC boundaries, and other overrides. Remove/replace conflicting override and verify inside/outside window.

For overlapping overrides, list all matching records and their creation/update
times before deleting anything. Preserve the valid absence/leave record and
replace only the conflicting interval. Verify the original responder resumes at
the exact override end unless another override or rotation handoff applies.

## Schedule preview is correct but paging is wrong

Inspect escalation policy attachment/step, test incident timestamp, target resolution evidence, notification preferences/endpoints, delivery history, provider, and queue health. Schedule correctness and delivery correctness are separate.

| Boundary | Healthy evidence | Follow when unhealthy |
| --- | --- | --- |
| schedule | intended responder at incident timestamp | layer, zone, override |
| escalation | step resolves that schedule and user | service/policy generation |
| eligibility | active user and enabled endpoint | user and notification preferences |
| delivery | intent, attempt, provider acceptance | worker/provider runbook |

Record schedule ID, evaluated UTC timestamp, local zone and offset, layer,
override IDs, resolved responder, policy step, and delivery ID. Never include
personal phone numbers or tokens in shared evidence.

## Recovery verification

Run [Test an on-call route](./test-on-call) and retain schedule target, policy, delivery, acknowledgement, and resolution evidence.
