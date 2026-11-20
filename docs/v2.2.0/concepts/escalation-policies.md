---
title: Escalation policies
description: Ordered response targets, timing, and fallback behavior.
type: concept
product_area: escalation
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/escalation/, prisma/schema.prisma]
---

# Escalation policies

Escalation policies define ordered response steps. Each step resolves targets,
timing, and fallback behavior into notification work for an incident.

A step targets a user, team, or effective on-call schedule and declares its
delay and channels. Resolution happens when the step executes, so schedule
changes can affect a future target while the incident's lifecycle generation
still protects against stale execution.

Use a zero-delay primary step, explicit backup steps, and at least one viable
terminal target. Test policies with unavailable users and empty schedules; a
policy that looks complete in the editor can still have no eligible recipient.

## Step outcomes and policy insights

Every escalation step now records an attempt row: scheduled, notified, skipped
or failed. A daily rollup derives acknowledged, timed-out and unanswered counts
from them. A step whose target was deleted or
deactivated records why (`TARGET_MISSING`, `TARGET_INACTIVE` or
`TARGET_INVALID`). These rows are for analytics only; they never change how an
incident escalates. When escalation insights are on, OpsKnight also fills the
last 90 days from incident timelines once. Those older rows are marked
approximate and never overwrite live ones.

When **Compute operations insights** and its **Escalation policies** area are on
(both off by default), the policy page shows per-step outcomes over the last 30
days, and OpsKnight raises insights such as:

- a step that was paged at least 5 times and never acknowledged;
- a step that is always skipped, so incidents go straight to the next step;
- step 1 timing out most nights (22:00–07:00 for the person paged);
- a shorter wait before the next step, when 75% of acknowledgements arrive
  well inside the current delay;
- one person on every step, or a policy no service uses.

Steps that target a single person are not judged on acknowledgement, so the
insights never publish one person's response record.

When noise control groups an incident under a storm parent and the parent
resolves while a child that was never paged is still open and firing,
OpsKnight pages the child with a fresh escalation run, the same way
unsuppressing does.
