---
title: Privacy requests and retention
description: Data-subject workflows, retention controls, holds, export, and erasure boundaries.
type: concept
product_area: privacy
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/privacy/requests.ts, src/lib/retention-policy.ts]
---

# Privacy requests and retention

Privacy requests are identity-bound workflows with explicit status, verification,
assignment, export, and erasure evidence. Retention policies govern eligible data;
holds prevent selected records from being removed. Export availability does not
imply erasure eligibility, and erasure must preserve legally or operationally
required references and immutable audit evidence.

Verification establishes that the requester may act for the subject; assignment
establishes who owns the workflow. Neither is evidence that every discovered
record may be disclosed or deleted. Preview the affected resources and resolve
manual-review flags before executing erasure.

A retention hold takes precedence over scheduled cleanup for the resources in
scope. Releasing a hold restores normal eligibility but does not promise
immediate deletion. Encryption-key retirement, database backups, third-party
systems, and exported artifacts each have their own lifecycle and must be
included in the deployment's privacy procedure.

Preserve request transitions, operator decisions, export generation, erasure
results, and hold changes as audit evidence. Avoid copying subject data into
free-form notes when a stable record reference is sufficient.
