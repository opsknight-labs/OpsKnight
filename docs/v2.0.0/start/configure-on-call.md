---
title: Configure on-call for your first service
description: Create a schedule and escalation policy for a new service.
type: tutorial
product_area: getting-started
audience: [administrator]
keywords: [configure on-call, on-call schedule, responder rotation, escalation policy]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/(app)/schedules/, src/lib/escalation/]
---

# Configure on-call for your first service

## Before you begin

Create the service and activate at least one responder account.

1. Open **Schedules → Create schedule**.
2. Choose the time zone, add a rotation layer, and add responders.
3. Save and verify the current on-call preview.
4. Open **Escalation Policies → Create policy**.
5. Add a step targeting the schedule and choose its delay.
6. Assign the policy to the service.

For advanced rotations and temporary coverage, see
[Build an on-call schedule](../guides/on-call/build-schedule) and
[Schedule overrides](../guides/on-call/overrides).
