---
title: OIDC login succeeds but access is wrong
description: Diagnose account linking, role mapping, provisioning, and stale session access.
type: troubleshooting
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/oidc.ts, src/lib/auth.ts]
---

# OIDC login succeeds but access is wrong

Inspect the linked user, issuer and subject, controlled role claim, role source,
active status, and team scope. Compare the current provider claims with the stored
mapping policy. Revoke or refresh the session after correcting policy. Do not
grant a broader local role merely to compensate for a broken claim mapping.

