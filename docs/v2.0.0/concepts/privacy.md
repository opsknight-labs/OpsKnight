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

