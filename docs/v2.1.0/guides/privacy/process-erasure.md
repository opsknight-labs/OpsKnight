---
title: Preview and execute privacy erasure
description: Assess erasure blockers, execute irreversible erasure, and verify retained audit evidence.
type: how-to
product_area: privacy
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Preview and safely execute a verified erasure request. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/lib/privacy/erasure/policy.ts", "src/lib/privacy/erasure/execute.ts", "src/app/api/compliance/privacy-requests/[id]/erasure/preview/route.ts"]
---

# Preview and execute privacy erasure

## Before you begin

Use an `ERASURE` request for a `USER` with verified identity in `PROCESSING`. Require erasure capability and an approved change/case record. Erasure is destructive; take and validate required backups while respecting the erasure policy for restored data. `STATUS_SUBSCRIBER` erasure is not automated in 2.0 and must follow the approved manual subscriber-data process.

## Open the feature

Open **Settings → Privacy Requests**, select the erasure request, and open **Erasure**.

## Configure the decision

1. Select **Preview erasure**.
2. Review every affected category, retained audit record, ownership dependency, and blocker.
3. Resolve or document holds and ownership transfers. Never bypass a blocker by editing the database.
4. Re-run preview until the current request is executable.
5. Confirm subject and request ID again, then execute once.

## What OpsKnight does

Execution rechecks verification and `PROCESSING` state inside the operation, claims the request against concurrent execution, applies the policy, records results, and retains the Privacy Request row as fulfilment evidence. A blocker moves the operation/request into auditable failed or blocked state rather than silently deleting partial data.

## Verify the erasure

Confirm execution is completed, the request reaches `COMPLETED`, prohibited subject data is no longer returned, and retained/audit records match the preview. Review audit logs for the actor and request.

## Roll back or recover

There is no UI undo. If execution fails, stop, preserve evidence, inspect the recorded phase, and resolve the blocker before a controlled retry. Do not restore erased personal data from backup into production without applying the erasure obligation to the restored dataset.

## Troubleshooting

- **Preview is blocked:** inspect legal hold, ownership, and dependency details.
- **Execute is unavailable:** verify permission, identity, request type, and `PROCESSING` state.
- **Concurrent/stale state:** reload the detail; another operator may have transitioned or claimed it.
- **Subscriber erasure has no preview/execute action:** this is expected. Do not substitute a user ID or edit the database; complete and evidence the manual subscriber erasure workflow.

## Next steps

- [Retention, holds, and troubleshooting](./retention-and-troubleshooting)
