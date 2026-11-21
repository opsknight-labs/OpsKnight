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
