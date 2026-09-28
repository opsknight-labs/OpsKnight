---
title: Permissions reference
description: Generated application roles, capabilities, and API scopes.
type: reference
product_area: authorization
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
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

- `admin.manage`
- `audit.read`
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
- `incident.sensitive.read`
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
- `schedule.read.all`
- `schedule.read.scoped`
- `service.read.all`
- `service.read.scoped`
- `user.read.all`

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
