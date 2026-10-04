---
title: On-call schedules
description: Rotations, layers, overrides, and effective on-call coverage.
type: concept
product_area: on-call
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/schedules/, prisma/schema.prisma]
---

# On-call schedules

Schedules calculate who is on call from layers, rotations, time zones, and
overrides. Escalation policies consume the effective schedule result.

Each layer has a start instant, rotation length, ordered participants, and time
zone interpretation. Multiple layers can contribute coverage. The effective
calculation is time-dependent and should be inspected for the exact incident
instant rather than inferred from the editor.

Overrides temporarily replace normal rotation output for a bounded interval.
They should identify both the replacement and the covered responder, avoid
ambiguous overlap, and be reviewed around daylight-saving transitions. See
[build a schedule](../guides/on-call/build-schedule) and [overrides](../guides/on-call/overrides).
