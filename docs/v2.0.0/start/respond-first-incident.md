---
title: Respond to your first incident
description: Acknowledge, investigate, and resolve an incident end to end.
type: tutorial
product_area: getting-started
audience: [responder]
verification:
  level: runtime
  verified_at: 2026-09-28
  evidence: [tests/docs/journeys/incident-lifecycle.spec.ts, src/lib/incidents/lifecycle.ts]
---

# Respond to your first incident

## Before you begin

Sign in as a responder and trigger the test alert from the preceding tutorial.

1. Open **Incidents** and select the triggered incident.
2. Review its service, urgency, source, and timeline.
3. Select **Acknowledge** so other responders know ownership is active.
4. Assign the incident if responsibility needs to be explicit.
5. Add investigation notes and coordinate through the configured ChatOps system
   when needed.
6. Select **Resolve**, record a useful resolution summary, and verify the final
   timeline event.

Continue with the [incident lifecycle concept](../concepts/incidents) for state
semantics or the task-specific [incident guides](../guides/incidents/).
