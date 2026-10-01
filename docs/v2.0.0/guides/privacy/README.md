---
title: Operate privacy requests
description: Receive, verify, assign, fulfil, and audit data-subject requests in OpsKnight.
type: concept
product_area: privacy
audience: [administrator, operator]
reader: { status: READER_COMPLETE }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/settings/privacy-requests/page.tsx", "src/lib/privacy/requests.ts", "src/lib/privacy/state-machine.ts"]
---

# Operate privacy requests

Privacy Requests is the controlled workflow for a request concerning an active OpsKnight user. The supported types are `ACCESS`, `PORTABILITY`, `RECTIFICATION`, `ERASURE`, `RESTRICTION`, and `OBJECTION`. Access, portability, and erasure have product automation; the other types require documented manual review and processing.

The lifecycle is `RECEIVED` → `IDENTITY_VERIFICATION` → `IN_REVIEW` or verified `PROCESSING` → `COMPLETED`. Operators can use `BLOCKED` or `REJECTED` where the state machine permits. Processing cannot begin without recorded identity verification.

- [Create, verify, assign, and review a request](./manage-request)
- [Export subject data](./export-data)
- [Preview and execute erasure](./process-erasure)
- [Retention, holds, and troubleshooting](./retention-and-troubleshooting)

Capabilities are separated: `PRIVACY_READ` opens the workspace, `PRIVACY_REQUESTS_MANAGE` changes lifecycle/assignment, `PRIVACY_EXPORT` creates or downloads exports, and `PRIVACY_ERASURE` executes erasure.
