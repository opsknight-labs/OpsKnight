---
title: Permissions
description: Roles, capabilities, scope, and tenant isolation.
type: concept
product_area: authorization
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/authorization.ts, src/lib/rbac.ts]
---

# Permissions

Permissions are capability checks evaluated in scope. User-interface visibility
is not an authorization boundary; server-side actions and API routes enforce the
effective capability and tenant ownership.

Application roles provide baseline capability sets. Resource scope then limits
which services, teams, incidents, and administration objects an actor can use.
API scopes constrain tokens independently of an interactive user's visible
navigation.

Deny access when identity, capability, or scope cannot be established. Audit
privileged changes and test both allowed and denied paths. The generated
[permissions reference](../reference/permissions) lists current capability and
scope names; it does not replace server-side policy.
