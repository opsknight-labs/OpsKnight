---
order: 2
title: Core Concepts
description: Master the fundamental building blocks of OpsKnight incident management
---

# Core Concepts

Understanding OpsKnight's core concepts is essential for building an effective incident management workflow. This section explains how each component works, why it exists, and how they connect to form a complete system.

---

## The Big Picture

OpsKnight is built around a simple but powerful model: **Alerts become Incidents, Incidents trigger Escalations, Escalations notify People**.

```
                    YOUR MONITORING STACK
    ┌─────────────────────────────────────────────────┐
    │  Datadog • Prometheus • CloudWatch • Sentry     │
    │  GitHub Actions • Custom Webhooks • 20+ more    │
    └─────────────────────────┬───────────────────────┘
                              │
                              ▼
    ┌─────────────────────────────────────────────────┐
    │                    SERVICES                      │
    │  Your monitored systems with ownership & policy  │
    │  API Gateway • Database • Payment Service        │
    └─────────────────────────┬───────────────────────┘
                              │
                              ▼
    ┌─────────────────────────────────────────────────┐
    │                    INCIDENTS                     │
    │  Actionable work items with lifecycle tracking   │
    │  OPEN • ACKNOWLEDGED • SNOOZED • SUPPRESSED • RESOLVED │
    └─────────────────────────┬───────────────────────┘
                              │
                              ▼
    ┌─────────────────────────────────────────────────┐
    │              ESCALATION POLICIES                 │
    │  Multi-step notification chains with delays      │
    │  Step 1 → Step 2 → Step 3 → Repeat               │
    └─────────────────────────┬───────────────────────┘
                              │
                              ▼
    ┌─────────────────────────────────────────────────┐
    │                   SCHEDULES                      │
    │  Who is on-call right now?                       │
    │  Layers • Rotations • Overrides                  │
    └─────────────────────────┬───────────────────────┘
                              │
                              ▼
    ┌─────────────────────────────────────────────────┐
    │              NOTIFICATIONS                       │
    │  Multi-channel delivery until acknowledged       │
    │  Email • SMS • Push • Slack • WhatsApp          │
    └─────────────────────────────────────────────────┘
```

---

## Concepts at a Glance

| Concept                                      | What It Is                              | Why It Matters                            |
| -------------------------------------------- | --------------------------------------- | ----------------------------------------- |
| [Dashboard](./dashboard)                     | Command center for real-time visibility | See the forest, not just the trees        |
| [Services](./services)                       | Systems you monitor with ownership      | Alerts need context and routing           |
| [Incidents](./incidents)                     | Actionable work items from alerts       | Track resolution from trigger to close    |
| [Escalation Policies](./escalation-policies) | Who gets notified and when              | Ensure issues never fall through cracks   |
| [Schedules](./schedules)                     | On-call rotations and shifts            | Fair distribution of on-call duty         |
| [Teams](./teams)                             | User groups with shared responsibility  | Organize people and permissions           |
| [Users](./users)                             | Individuals with roles and preferences  | Authentication and personalization        |
| [Analytics](./analytics)                     | Metrics, SLAs, and trends               | Measure and improve performance           |
| [Postmortems](./postmortems)                 | Incident retrospectives                 | Learn from failures                       |
| [Status Pages](./status-page)                | Public service health communication     | Transparency with customers               |
| [Integrations](./integrations)               | Connections to monitoring tools         | Route alerts from your stack              |
| [Scalability](./scalability)                 | Capacity targets and tuning             | Understand scale limits and optimizations |

---

## How Concepts Connect

### The Alert-to-Resolution Flow

1. **Alert Received**: A monitoring tool sends a webhook to OpsKnight
2. **Service Identified**: The routing key maps the alert to a Service
3. **Incident Created**: OpsKnight creates an Incident with deduplication
4. **Escalation Started**: The Service's Escalation Policy is triggered
5. **On-Call Found**: The Schedule determines who is currently on-call
6. **Notification Sent**: The on-call person receives alerts via configured channels
7. **Acknowledge**: The responder acknowledges, stopping further escalation
8. **Resolve**: The incident is fixed and marked resolved

### Key Relationships

```
Service ──────────────────┐
    │                     │
    ├── owns ────▶ Incidents
    │                     │
    └── uses ────▶ Escalation Policy
                          │
                          ├── Step 1 ──▶ Schedule ──▶ User (on-call)
                          ├── Step 2 ──▶ User (backup)
                          └── Step 3 ──▶ Team ──▶ All members
```

---

## Terminology Quick Reference

| Term           | Definition                                           |
| -------------- | ---------------------------------------------------- |
| **Alert**      | Raw event from a monitoring tool (webhook payload)   |
| **Incident**   | Actionable work item created from one or more alerts |
| **Dedup Key**  | Identifier to group related alerts into one incident |
| **Urgency**    | Impact level: HIGH, MEDIUM, or LOW                   |
| **Priority**   | Business priority: P1-P5 (most to least critical)    |
| **Escalation** | Process of notifying additional people over time     |
| **On-Call**    | The person currently responsible for responding      |
| **Shift**      | A time period when someone is on-call                |
| **Layer**      | A rotation pattern within a schedule                 |
| **Override**   | Temporary change to normal on-call assignment        |
| **MTTA**       | Mean Time To Acknowledge                             |
| **MTTR**       | Mean Time To Resolve                                 |
| **SLA**        | Service Level Agreement (target response times)      |

---

## Recommended Reading Order

If you're new to OpsKnight, we recommend reading the concepts in this order:

1. **[Services](./services)** — Start here to understand the foundation
2. **[Incidents](./incidents)** — Learn the core workflow
3. **[Escalation Policies](./escalation-policies)** — Understand notification routing
4. **[Schedules](./schedules)** — Configure on-call rotations
5. **[Teams](./teams)** — Organize your responders
6. **[Dashboard](./dashboard)** — Master the command center
7. **[Analytics](./analytics)** — Track and improve performance

---

## Deep Dives

### For Incident Responders

- [Incident Lifecycle](./incidents#incident-lifecycle) — Understand statuses and actions
- [Bulk Actions](./incidents#bulk-actions) — Manage alert storms efficiently
- [Mobile Access](./mobile) — Respond from anywhere

### For On-Call Managers

- [Schedule Layers](./schedules#layers) — Build complex coverage patterns
- [Overrides](./schedules#overrides) — Handle vacations and swaps
- [Fair Rotation](./schedules#fair-rotation) — Balance on-call burden

### For Operations Teams

- [SLA Configuration](./analytics#sla-tracking) — Set response time targets
- [Custom Fields](./administration/custom-fields) — Track additional metadata
- [Integrations](./integrations) — Connect your monitoring stack

### For Leadership

- [Analytics Dashboard](./analytics#dashboard) — Executive metrics
- [Status Pages](./status-page) — Customer communication
- [Postmortems](./postmortems) — Organizational learning
- [Scalability](./scalability) — Capacity planning and growth readiness

---

## Common Patterns

### Pattern 1: Simple Team Setup

For small teams with straightforward needs:

```
1 Service → 1 Escalation Policy → 1 Schedule (weekly rotation)
```

### Pattern 2: Primary/Secondary Coverage

For better redundancy:

```
1 Service → 1 Escalation Policy:
    Step 1: Primary Schedule (immediate)
    Step 2: Secondary Schedule (5 min delay)
    Step 3: Manager (10 min delay)
```

### Pattern 3: Follow-the-Sun

For global teams:

```
1 Service → 1 Escalation Policy:
    Step 1: Schedule (auto-selects based on timezone)
        Layer 1: US Team (9am-5pm PT)
        Layer 2: EU Team (9am-5pm CET)
        Layer 3: APAC Team (9am-5pm JST)
```

---

## Next Steps

Choose your path:

- **New to incident management?** Start with [Services](./services)
- **Setting up on-call?** Jump to [Schedules](./schedules)
- **Connecting tools?** See [Integrations](./integrations)
- **Measuring performance?** Explore [Analytics](./analytics)
