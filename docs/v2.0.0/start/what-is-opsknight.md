---
title: What is OpsKnight?
description: Understand the product model before configuring your first response workflow.
type: concept
product_area: getting-started
audience: [operator, administrator, responder]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/events.ts, src/lib/incidents/lifecycle.ts, src/lib/escalation/]
---

# What is OpsKnight?

OpsKnight receives operational events, correlates them into incidents owned by
services and teams, escalates to on-call responders, delivers notifications,
and records the response lifecycle.

The core flow is:

```text
Alert source → Service → Incident → Escalation policy
             → On-call responder → Notification provider → Response
```

Services define operational ownership. Teams group responders. Schedules decide
who is on call. Escalation policies decide who is contacted and when. Notification
routing chooses the delivery channels. Status pages and ChatOps project selected
incident state to external audiences.

Continue with the [Quickstart](./quickstart) when you are ready to install.

