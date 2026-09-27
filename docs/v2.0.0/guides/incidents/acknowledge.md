---
title: Acknowledge an incident
description: Record that a responder has taken ownership of an open incident.
type: how-to
product_area: incidents
audience: [responder, administrator]
verification:
  level: test
  verified_at: 2026-09-27
  evidence:
    - tests/docs/journeys/incident-lifecycle.spec.ts
    - src/components/incident/detail/actions.ts
---

# Acknowledge an incident

## Prerequisites

The incident must be visible to you and your effective permissions must include
`incident.acknowledge.scoped` or broader incident-management access.

## Steps

1. Open the incident detail page.
2. Review the service, urgency, current assignee, and response timer.
3. Select **Acknowledge** once.

## Expected result and verification

The status changes to **Acknowledged**, `acknowledgedAt` is recorded, the first
acknowledgement SLA measurement is preserved, and active escalation is stopped
or paused according to the lifecycle contract. Confirm the acknowledgement in
the header and timeline.

Acknowledgement is not assignment and does not resolve the incident.

