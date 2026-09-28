---
title: Manage roles and permissions
description: Assign stable roles while preserving scoped authorization boundaries.
type: how-to
product_area: authorization
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/authorization.ts
    - src/lib/authorization-policy.ts
---

# Manage roles and permissions

## Before you begin

Sign in as an administrator and identify the minimum business task and resource scope.

1. Apply the least-privileged role to a low-risk test account.
2. Verify allowed and denied behavior before changing the production account.

Choose the least-privileged stable role that supplies the required capability
bundle. Test the actor against both an in-scope and out-of-scope resource.

Interface visibility is only a hint. Server actions and API routes must enforce
capability, resource scope, and tenant ownership. Re-test OIDC role mappings and
active sessions after any identity-policy change.

Before changing a role, record the business task and the resources it must
touch. Apply the role to a synthetic or low-risk account first, then verify read
and mutation behavior for owned, team-scoped, and unrelated records. Include API
keys owned by that user because they inherit the owner's authorization.

After promotion or demotion, confirm the audit entry and reauthenticate the test
account. If access is broader than expected, restore the previous assignment,
capture the denied/allowed resource identifiers and route, and inspect policy
resolution rather than relying on hidden navigation items.
