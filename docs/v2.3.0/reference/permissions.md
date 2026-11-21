---
title: Permissions reference
description: Generated application roles, capabilities, and API scopes.
type: reference
product_area: authorization
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-10-16
  evidence:
    - src/lib/authorization.ts
---

# Permissions reference

This page is generated from `src/lib/authorization.ts`. Server-side policy and
resource scope remain authoritative.

## Roles

- `ADMIN`
- `RESPONDER`
- `AUDITOR`
- `USER`

## Capabilities

- `access.review.manage`
- `admin.manage`
- `audit.export`
- `audit.read`
- `automation.edit`
- `automation.publish`
- `automation.read`
- `compliance.drift.manage`
- `compliance.evaluate`
- `compliance.evidence.read`
- `compliance.export`
- `compliance.read`
- `encryption.manage`
- `encryption.read`
- `incident.acknowledge.scoped`
- `incident.create.all`
- `incident.create.scoped`
- `incident.escalate.scoped`
- `incident.export`
- `incident.note.scoped`
- `incident.read.all`
- `incident.read.scoped`
- `incident.resolve.scoped`
- `incident.sensitive.read`
- `intelligence.feedback`
- `intelligence.manage`
- `intelligence.read`
- `intelligence.suggestions.read`
- `metrics.read.all`
- `metrics.read.scoped`
- `operations.manage`
- `policy.read.all`
- `postmortem.draft.read`
- `privacy.erasure`
- `privacy.export`
- `privacy.read`
- `privacy.requests.manage`
- `report.export`
- `report.read`
- `retention.holds.manage`
- `retention.manage`
- `retention.read`
- `runbook.agent.manage`
- `runbook.approve`
- `runbook.artifact.download`
- `runbook.execute`
- `runbook.manage`
- `runbook.publish`
- `runbook.read.all`
- `runbook.read.scoped`
- `runbook.secret.manage`
- `schedule.read.all`
- `schedule.read.scoped`
- `service.read.all`
- `service.read.scoped`
- `team.administer.scoped`
- `user.notification_preferences`
- `user.read.all`

Intelligence (AIOps) capabilities by role: `ADMIN` has all four, including
`intelligence.manage` for policy changes. `RESPONDER` has `intelligence.read`,
`intelligence.suggestions.read` and `intelligence.feedback`. `AUDITOR` has
`intelligence.read` and `intelligence.suggestions.read` and can never change
decisions. `USER` has `intelligence.suggestions.read` and
`intelligence.feedback`, and sees suggestions only for incidents it can already
read. Feedback is visibility-checked, rate-limited and kept to one live verdict
per person.

## Authorization actions

- `event.create`
- `incident.acknowledge`
- `incident.create`
- `incident.escalate`
- `incident.manage`
- `incident.note`
- `incident.read`
- `schedule.read`
- `service.read`

## API scopes

- `events:write`
- `incidents:read`
- `incidents:write`
- `response-policy:read`
- `response-policy:write`
- `schedules:read`
- `services:read`
