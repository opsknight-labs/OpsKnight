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

Execution rechecks verification and `PROCESSING` state inside the operation, claims the request against concurrent execution, applies the policy, records results, and retains the Privacy Request row as fulfilment evidence. The subject's own audit entries are kept and pseudonymised: the IP address is cleared and their email, name, phone number and known IP addresses are replaced with `[erased]` in each entry's details. Entries keyed by the person's email address, such as failed sign-ins for an unrecognised account, also lose that address from their entity ID, so searching the audit log for the erased email returns nothing. The preview's audit count is the number of entries this covers. In incidents, the subject's email, name and phone number are also replaced with `[erased]` in the notes they wrote and in timeline entries that name them (for example, "Note added via Slack ChatOps by ..."). The scrub is bounded so the erasure always finishes: timeline entries are searched only on incidents the subject took part in (they wrote a note, were the assignee or the person who acknowledged, watched it, held an incident role, or were added to its war room), at most 1,000 incidents (newest first), and at most 5,000 notes and 5,000 timeline entries are examined per erasure. A name is replaced only when it is a full name (it contains a space and has at least 5 characters) and an email address only when it is not the tail of a longer address, so a one-word display name such as "Admin" or `malice@example.com` is left alone. If a bound is reached, the rest stays and the `privacy.erasure.completed` audit entry records `incidentTextTruncated: true`; review those incidents manually. Incidents under a legal hold are left as they are, and so are audit entries a hold on another user protects (including their email columns). Notes other people wrote that mention the subject are not attributable and stay, so review them manually. Incident templates the subject created are kept and reassigned to the administrator who runs the erasure, or to the first active administrator when the operator does not have the `admin.manage` permission. A blocker moves the operation/request into auditable failed or blocked state rather than silently deleting partial data.

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
