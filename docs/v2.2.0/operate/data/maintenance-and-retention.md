---
title: Maintain data and retention
description: Configure, verify, and change retention and storage maintenance without losing required evidence.
type: how-to
product_area: data
audience: [operator, administrator]
reader:
  status: READER_COMPLETE
  task: Configure, verify, and safely change data-retention policy and holds.
verification:
  level: source
  verified_at: 2026-09-30
  evidence: [src/lib/retention-policy.ts, src/components/settings/RetentionPolicySettings.tsx, prisma/schema.prisma]
---

# Maintain data and retention

## Before you begin

Approve retention requirements with security, privacy, compliance, legal, and database owners. Prove a recent backup through an isolated restore. Inventory active holds; retention cleanup is destructive and a later policy extension cannot recreate deleted data.

## Open the feature

Sign in with retention-management permission and open **Settings → System → Data Retention**. Record the saved values and active holds before editing.

## Understand how retention works

The policy controls incident, alert, audit/event history, metrics, realtime-query, completed privacy-request, expired privacy-artifact, and unsubscribed-subscriber windows. Cleanup runs asynchronously. Holds override ordinary eligibility, and a saved policy is not proof that cleanup finished.

Supported boundaries include incident retention from 30–3,650 days, alert retention from 7–3,650, log retention from 1–3,650, metrics retention from 30–3,650, and realtime windows from 7–365 days. The realtime window cannot exceed metrics retention.

## Configure retention

1. Inventory record classes, growth, regulatory requirements, and deletion obligations.
2. Select an approved preset or enter each retention window explicitly.
3. Confirm the business-hours timezone and privacy-lifecycle windows.
4. Review retention holds and exclusions.
5. Select **Save**, then record the audit event and expected first cleanup interval.
6. Schedule database-native maintenance away from paging peaks.

## Verify the change

Refresh and confirm the saved values reload. Verify the audit record identifies the administrator and changed fields, held records remain protected, eligible counts move as expected, and cleanup jobs finish without failures. Compare database and object-storage growth over at least one cleanup interval.

## Undo or extend retention

Restore the recorded values and save again if eligibility is broader than approved or cleanup fails. Extending a window protects records that still exist; use the approved recovery process if already-deleted records must be restored.

## Troubleshooting

**Save is rejected:** correct the displayed range and ensure the realtime window does not exceed metrics retention.

**Storage does not shrink immediately:** confirm cleanup completion, then follow PostgreSQL/provider guidance for vacuuming and physical reclamation.

**A held record was selected:** stop cleanup, preserve evidence, verify hold scope and migration state, and escalate as a data-integrity incident.

## Next steps

- [Back up and restore data](./backup-and-restore)
- [Audit logs](../../guides/administration/audit-logs)
- [Privacy](../../concepts/privacy)
