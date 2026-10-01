---
title: Export privacy-request data
description: Generate, verify, download, and complete an access or portability export safely.
type: how-to
product_area: privacy
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Produce and validate a privacy export. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/lib/privacy/export/artifact.ts", "src/app/api/compliance/privacy-requests/[id]/export/route.ts", "src/app/api/compliance/privacy-requests/[id]/export/[artifactId]/download/route.ts"]
---

# Export privacy-request data

## Before you begin

Use an `ACCESS` or `PORTABILITY` request for a `USER` whose identity is verified and status is `PROCESSING`. The operator needs export capability. Agree on an approved secure delivery channel outside OpsKnight. `STATUS_SUBSCRIBER` export is not automated in 2.0; collect and deliver that subject's data through the approved manual process instead.

## Open the feature

Open **Settings → Privacy Requests**, select the request, and open its export section.

## Configure and generate the export

1. Reconfirm subject, request type, verification, and processing status.
2. Select **Generate export** once; wait for the artifact status rather than repeatedly submitting.
3. Confirm the artifact becomes ready and records checksum, size, expiry, and download count.
4. Download it before expiry and store it only in the approved case location.
5. Validate the archive can be opened and its subject matches the request.

## What OpsKnight does

The artifact is encrypted at rest, tied to one request, expires server-side, and records downloads. Eligible user access and portability requests use the same automation gate. Manual request types and every status-page subscriber request cannot invoke it.

## Verify the export

Compare the downloaded checksum and size with the detail view, inspect representative records, and record secure delivery in the case system. Mark the request complete only after fulfilment is verified.

## Remove or undo

You cannot turn an export into a different subject's artifact. Let an erroneous artifact expire, restrict access to it, and generate the correct artifact from the correct verified request. Follow retention policy for completed requests.

## Troubleshooting

- **Generate is disabled:** confirm type, `PROCESSING`, verification, and export permission.
- **Download is denied:** the artifact may be expired, failed, or associated with another request.
- **Artifact failed:** inspect the recorded failure and application logs before retrying.
- **Subscriber export says manual fulfilment:** this is expected in 2.0. Do not change the subject type to bypass the boundary; complete the approved manual export and record its evidence.

## Next steps

- [Manage the request](./manage-request)
- [Retention and holds](./retention-and-troubleshooting)
