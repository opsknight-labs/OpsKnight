---
title: Incident response
description: Acknowledgement, assignment, escalation, coordination, and resolution.
type: concept
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/incidents/lifecycle.ts, src/lib/escalation/]
---

# Incident response

Response moves from awareness to ownership, mitigation, resolution, and
learning. Acknowledgement and assignment are distinct actions with distinct
audit and timing implications.

Acknowledgement says a responder has accepted awareness and stops work that is
only valid for an unacknowledged generation. Assignment identifies the current
owner. Either can happen first, so automation and reports must not infer one
from the other.

Escalation continues according to policy until lifecycle state makes the next
step stale. Resolution is terminal for active response and records timing and a
resolution kind; reopening creates a new active generation without erasing the
prior response record. Chat rooms, status updates, Jira issues, and notifications
are coordinated projections of this authoritative incident state.
