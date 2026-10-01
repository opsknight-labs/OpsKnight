---
title: Privacy retention, holds, and troubleshooting
description: Operate privacy retention boundaries and recover blocked request workflows without bypassing controls.
type: troubleshooting
product_area: privacy
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Diagnose a blocked privacy request safely. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/components/settings/RetentionPolicySettings.tsx", "src/lib/privacy/erasure/policy.ts", "src/lib/privacy/requests.ts"]
---

# Privacy retention, holds, and troubleshooting

## Request is blocked

Open the request detail, read the recorded reason, identify whether verification, assignment, ownership, a retention hold, or a dependency caused it, and resolve the source condition. Move out of `BLOCKED` only through an offered transition and retain the case evidence.

## Completed request retention is wrong

Review the completed-request retention setting. Its accepted range is 30–3650 days. Confirm cleanup jobs are healthy and that a hold intentionally preventing removal is still authorized.

## Export expired or cannot be downloaded

Confirm artifact expiry and status. Do not alter expiry in the database. If the verified request remains eligible, generate a new artifact and deliver it through the approved channel.

## Erasure conflicts with a hold

Do not bypass the hold. Escalate to the privacy/legal owner, record the decision, and leave the request blocked until the hold is released or the request is lawfully rejected.

## Audit or permission failure

Confirm the actor has the specific read/manage/export/erasure capability, not merely an administrator-looking role. Inspect application and audit logs using the request ID. Retry only after resolving the denied capability or transient failure.

## Related pages

- [Create and review a request](./manage-request)
- [Export data](./export-data)
- [Process erasure](./process-erasure)
- [Privacy model](../../concepts/privacy)
