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

Choose the least-privileged stable role that supplies the required capability
bundle. Test the actor against both an in-scope and out-of-scope resource.

Interface visibility is only a hint. Server actions and API routes must enforce
capability, resource scope, and tenant ownership. Re-test OIDC role mappings and
active sessions after any identity-policy change.

