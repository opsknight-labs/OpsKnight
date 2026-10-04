---
title: On-call schedule tasks
order: 1
description: Build, test, hand off, and troubleshoot on-call coverage.
type: concept
product_area: on_call
audience: [administrator, responder]
verification: { level: source, verified_at: 2026-10-01, evidence: [src/app/(app)/schedules] }
---

# On-call schedules

Create coverage in this order: [create a schedule](./create-schedule), define
[rotations](./rotations), [test current and future coverage](./test-on-call),
then attach the schedule through escalation policy steps. Use
[overrides](./overrides) for temporary exceptions and [handoffs](./handoffs) for
planned transfer. If the wrong responder is selected, follow
[troubleshooting](./troubleshooting) before editing historical rotations.
