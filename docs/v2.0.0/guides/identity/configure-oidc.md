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

Use the provider's discovery document over TLS and require the configured issuer
to match exactly. Register every intended production callback explicitly; do not
use wildcard redirect URIs. Confirm that the email claim is stable and unique,
and enable strict verified-email enforcement when the provider supplies a
trustworthy verification claim.

Roll out to a pilot group before making OIDC the primary path. Verify that a
disabled provider user can no longer establish a session and that an existing
session follows the configured session policy. If callbacks fail, collect the
request ID, external origin, issuer, callback URL, and provider error without
recording authorization codes, tokens, or the client secret.
