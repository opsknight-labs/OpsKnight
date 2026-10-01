---
title: Configure incident SLA and classification policy
description: Define workspace objectives, priority rules, classification, support hours, and service inheritance.
type: how-to
product_area: incidents
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Configure and verify an incident SLA policy. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/components/settings/incident-sla/IncidentSlaClientView.tsx", "src/app/(app)/settings/incident-sla/actions.ts", "src/lib/incidents/creation.ts"]
---

# Configure incident SLA and classification policy

## Before you begin

Agree on workspace acknowledgment/resolution objectives, P1–P5 targets, provider severity mapping, staffed hours, and which services need exceptions. Changes apply only to future incident contracts; existing incidents retain targets and policy versions captured when triggered.

## Open the feature

Open **Settings → Incident SLA**. The workspace contains **SLA Objectives (P1–P5)**, **Alert Classification**, **Support & Schedules**, and **Semantics & Reference**.

## Configure SLA objectives

1. Define fallback acknowledgment minutes and resolution duration.
2. Add or update P1–P5 rules; review each target independently.
3. Save the workspace policy and record its new version.
4. Review the count of services inheriting the workspace policy.
5. For a justified exception, open that service and configure its supported override; avoid duplicating workspace values without a reason.

## Configure alert classification

1. Decide whether provider severity derives urgency and whether urgency derives priority.
2. Set fallback behavior explicitly rather than relying on an assumed provider default.
3. Configure ordered classification rules and their priority mode: inherit, fallback, set, or clear.
4. Test representative critical/error/warning/info payloads from each integration.

## Configure support hours

Choose an IANA timezone and policy mode. For scheduled support, define at least one recurring staffed window and add date exceptions for holidays or special coverage. Workspace support hours cannot inherit. Confirm overnight windows and daylight-saving boundaries with concrete dates.

## What OpsKnight does

Incident creation resolves classification first, then selects and freezes the applicable SLA target and provenance on the incident. Later policy edits do not rewrite that contract. Source recovery before the ACK deadline can resolve without an ACK breach; recovery after the deadline or manual resolution without ACK records the acknowledgment breach.

## Verify the policy

Create controlled incidents for at least two priorities, one service override, one inherited service, and an inside/outside support-hours case. Confirm priority, urgency, target source, policy version, deadlines, and breach behavior match the intended contract.

## Roll back or change

Save a new policy version with the previous values. Existing incidents remain on their frozen contracts, so validate rollback using newly created incidents. Remove a service override to return future incidents to workspace inheritance.

## Troubleshooting

- **Unexpected target:** inspect priority, service override, workspace rule, and the incident's captured target source/version.
- **Rule appears ignored:** classification order or an explicit payload priority may have won.
- **Support window invalid:** confirm IANA timezone, non-overlapping windows, and required recurring coverage.

## Next steps

- [Migrate the SLA scheduler](./migrate-sla-scheduler)
- [Incident SLA concept](../../concepts/incident-sla)
