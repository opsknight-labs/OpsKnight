---
title: Configure OIDC
description: Connect an OpenID Connect provider and test safe sign-in behavior.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/oidc.ts
    - src/app/api/auth/oidc/logout-url/route.ts
---

# Configure OIDC

Register the exact OpsKnight redirect URI with the identity provider. Configure
issuer, client identifier, encrypted client secret, scopes, and provisioning or
role rules. Keep a tested local administrator available during rollout.

Test allowed and denied users, issuer and audience validation, account linking,
role mapping, logout, and callback behavior through the externally visible
origin. Authentication success does not bypass server-side authorization.

