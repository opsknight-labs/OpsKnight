---
title: Create and review a privacy request
description: Create a user privacy request, verify identity, assign an operator, and control its lifecycle.
type: how-to
product_area: privacy
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: "Create, verify, assign, and review a privacy request." }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/components/settings/privacy/PrivacyRequestsBoard.tsx", "src/components/settings/privacy/PrivacyRequestDetailDialog.tsx", "src/lib/privacy/state-machine.ts"]
---

# Create and review a privacy request

## Before you begin

Obtain the request through your approved intake process and retain its external case reference outside free-form notes when policy requires it. Confirm the operator has privacy-management capability. In 2.0 the operable subject type is `USER`; `STATUS_SUBSCRIBER` is reserved in the schema and is not an operable UI workflow.

## Open the feature

Open **Settings → Privacy Requests**. The board supports search, status/type filters, cursor pagination, assignment, and request detail.

## Configure the request

1. Select **New Request**.
2. Select the active user who is the subject.
3. Choose `ACCESS`, `PORTABILITY`, `RECTIFICATION`, `ERASURE`, `RESTRICTION`, or `OBJECTION`.
4. Add notes that explain scope without copying unnecessary sensitive data.
5. Create the request; it starts as `RECEIVED` with verification pending.
6. Move it to `IDENTITY_VERIFICATION` and perform the organization's identity check.
7. Record the verification method/reference and mark verification complete.
8. Assign an eligible active administrator or auditor.
9. Use `IN_REVIEW` for legal/scope review or move a verified request to `PROCESSING` for fulfilment.

## What OpsKnight does

Every lifecycle change is validated by the privacy state machine and audited. Entering `PROCESSING` requires `verifiedAt`. A request leaving identity verification for review records verification; moving to blocked/rejected does not falsely stamp verification. Terminal states are `COMPLETED` and `REJECTED`.

## Verify the request

Reopen the detail dialog and confirm subject, type, assignee, status, verification method/reference, requested date, and audit history. Search for the subject and verify the filtered board returns the request.

## Change or undo

Use `BLOCKED` when fulfilment is temporarily impossible and record the operational/legal reason. Return it only through an allowed transition. Use `REJECTED` for a final refusal and supply the rejection reason. Do not mark `COMPLETED` until export, erasure, or the manual process has produced auditable evidence.

## Troubleshooting

- **Processing is unavailable:** identity has not been verified.
- **Assignee is missing:** only active users with privacy-management capability are candidates.
- **Transition is rejected:** follow the allowed lifecycle instead of skipping states.
- **Subject is absent:** the creation picker returns active users and is limited; search/confirm the account state.

## Next steps

- [Export subject data](./export-data)
- [Process erasure](./process-erasure)
- [Retention and troubleshooting](./retention-and-troubleshooting)
