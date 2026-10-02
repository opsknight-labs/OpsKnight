---
title: Create and review a privacy request
description: Create a user or status-subscriber privacy request, verify identity, assign an operator, and control its lifecycle.
type: how-to
product_area: privacy
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: "Create, verify, assign, and review a privacy request." }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/components/settings/privacy/PrivacyRequestsBoard.tsx", "src/components/settings/privacy/PrivacyRequestDetailDialog.tsx", "src/lib/privacy/state-machine.ts", "docs/v2.0.0/assets/privacy-requests.png"]
---

# Create and review a privacy request

## Before you begin

Obtain the request through your approved intake process and retain its external case reference outside free-form notes when policy requires it. Confirm the operator has privacy-management capability. OpsKnight accepts `USER` and `STATUS_SUBSCRIBER` subjects. User requests can use automation where the request type is eligible; every status-page subscriber request requires manual fulfilment in 2.0.

## Open the feature

Open **Settings → Privacy Requests**. The board supports search, status/type filters, cursor pagination, assignment, and request detail.

![Privacy request workspace with tracked request state, subject, type, assignment, and lifecycle controls](/docs/v2.0.0/assets/privacy-requests.png)

## Configure the request

1. Select **New Request**.
2. Choose **User** or **Status page subscriber** as the subject type.
3. For a user, search for and select the active account. For a subscriber, enter the exact status-subscriber CUID obtained through the approved status-page administration process. The subject cannot be changed after creation.
4. Choose `ACCESS`, `PORTABILITY`, `RECTIFICATION`, `ERASURE`, `RESTRICTION`, or `OBJECTION`. The form marks manual-only combinations as **not yet automated**.
5. Add notes that explain scope without copying unnecessary sensitive data.
6. Create the request; it starts as `RECEIVED` with verification pending.
7. Move it to `IDENTITY_VERIFICATION` and perform the organization's identity check.
8. Record the verification method/reference and mark verification complete.
9. Assign an eligible active administrator or auditor.
10. Use `IN_REVIEW` for legal/scope review or move a verified request to `PROCESSING` for fulfilment.

## What OpsKnight does

Every lifecycle change is validated by the privacy state machine and audited. Entering `PROCESSING` requires `verifiedAt`. A request leaving identity verification for review records verification; moving to blocked/rejected does not falsely stamp verification. Terminal states are `COMPLETED` and `REJECTED`. For `STATUS_SUBSCRIBER`, OpsKnight tracks this lifecycle but does not generate an automated export or execute automated erasure; the operator must document the manual result before completion.

## Verify the request

Reopen the detail dialog and confirm subject, type, assignee, status, verification method/reference, requested date, and audit history. Search for the subject and verify the filtered board returns the request.

## Change or undo

Use `BLOCKED` when fulfilment is temporarily impossible and record the operational/legal reason. Return it only through an allowed transition. Use `REJECTED` for a final refusal and supply the rejection reason. Do not mark `COMPLETED` until export, erasure, or the manual process has produced auditable evidence.

## Troubleshooting

- **Processing is unavailable:** identity has not been verified.
- **Assignee is missing:** only active users with privacy-management capability are candidates.
- **Transition is rejected:** follow the allowed lifecycle instead of skipping states.
- **User subject is absent:** the creation picker returns active users; search and confirm the account state.
- **Subscriber subject is rejected:** confirm the exact subscriber CUID rather than entering an email address or status-page ID.
- **Subscriber automation is unavailable:** this is the supported 2.0 boundary; fulfil manually and attach the external evidence to the approved case record.

## Next steps

- [Export subject data](./export-data)
- [Process erasure](./process-erasure)
- [Retention and troubleshooting](./retention-and-troubleshooting)
