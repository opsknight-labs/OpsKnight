---
title: Configure SCIM provisioning
description: Provision and deactivate lifecycle-managed users through SCIM.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/app/api/scim/v2/Users/route.ts
    - src/app/api/scim/v2/Users/[id]/route.ts
---

# Configure SCIM provisioning

Generate a dedicated SCIM credential, configure the provider base URL, and test
user create, read, update, patch, and deactivation against synthetic identities.
Do not reuse an OIDC client secret as a SCIM token.

Verify the provider external identifier, email uniqueness, active state, and
role-source behavior. Deprovisioning affects access but must preserve incident,
audit, and ownership references according to product policy.

