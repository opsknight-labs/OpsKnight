---
title: Escalate an incident
description: Manually advance response when an incident needs more attention.
type: how-to
product_area: escalation
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/escalation/worker.ts
    - src/lib/escalation/planner.ts
---

# Escalate an incident

Before escalating, confirm that the incident is active and the service has a
valid escalation policy. Use the incident escalation action to advance the
current response step. Verify the next step, resolved targets, and notification
intent in the timeline and notification history.

Do not repeatedly escalate while a request is pending. Target resolution and
notification creation are idempotent boundaries, but repeated operator actions
make diagnosis harder.

