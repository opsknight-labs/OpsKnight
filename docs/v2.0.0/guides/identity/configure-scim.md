---
title: Configure SCIM provisioning
description: Provision and deactivate lifecycle-managed users through SCIM.
type: how-to
product_area: identity
audience: [administrator, operator]
keywords: [SCIM provisioning, user provisioning, SCIM users, identity lifecycle]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/app/api/scim/v2/Users/route.ts
    - src/app/api/scim/v2/Users/[id]/route.ts
---

# Configure SCIM provisioning

## Before you begin

Create a high-entropy SCIM bearer token and choose a non-production provisioning group.

1. Configure the OpsKnight SCIM base URL and token in the identity provider.
2. Provision and deactivate a test user, then verify both transitions.

Generate a dedicated SCIM credential, configure the provider base URL, and test
user create, read, update, patch, and deactivation against synthetic identities.
Do not reuse an OIDC client secret as a SCIM token.

Verify the provider external identifier, email uniqueness, active state, and
role-source behavior. Deprovisioning affects access but must preserve incident,
audit, and ownership references according to product policy.

Scope the provisioning application to a pilot group and use a credential held
only by that application. Exercise filtering and pagination as well as writes;
the provider must reconcile by the stable SCIM identifier rather than creating
duplicates after an email change.

For rotation, create and validate the replacement token before retiring the old
one, with the overlap limited to the planned maintenance window. Review failed
requests by HTTP status, SCIM error body, request ID, and sanitized resource ID.
Repeated retries cannot repair uniqueness conflicts or unsupported attributes;
correct the source mapping first.
