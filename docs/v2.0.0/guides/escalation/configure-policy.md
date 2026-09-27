---
title: Configure an escalation policy
description: Route unanswered incidents through ordered response targets.
type: how-to
product_area: escalation
audience: [administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/escalation/policy-validation.ts
    - src/lib/escalation/target-resolution.ts
---

# Configure an escalation policy

Create a policy, add ordered steps, select each user, team, or schedule target,
choose the delay and notification channels, and save. Attach the policy to a
test service and trigger an incident.

Verify that step order is unique, every target resolves to an eligible recipient,
and configured channels have usable endpoints. A syntactically valid policy can
still be operationally empty when its target has no active members or coverage.

