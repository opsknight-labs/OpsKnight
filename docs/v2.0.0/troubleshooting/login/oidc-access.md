---
title: OIDC login succeeds but access is wrong
description: Diagnose account linking, role mapping, provisioning, and stale session access.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify oidc access.
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

## Isolate authentication from authorization

1. Confirm the callback completed and record issuer, subject, and user ID.
2. Verify the linked account is active and that issuer/subject match exactly.
3. Compare the current role/team claims with the configured mapping rules.
4. Inspect whether the role source is OIDC, SCIM, or locally controlled.
5. End the existing session and authenticate again after changing mappings.

If no user is linked, diagnose provisioning or linking. If the correct user is
linked but permissions are wrong, diagnose mapping and resource scope. If a new
session still contains old access, inspect provider claim freshness and session
cache configuration.

Verify with a least-privileged test account against one allowed and one denied
operation. Preserve redacted claims, issuer, subject hash, mapping rule, role
source, and request ID; never collect tokens or client secrets.
