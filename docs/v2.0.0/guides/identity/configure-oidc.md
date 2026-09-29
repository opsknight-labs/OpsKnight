---
title: Configure OIDC
description: Connect an OpenID Connect provider and test safe sign-in behavior.
type: how-to
product_area: identity
audience: [administrator, operator]
keywords: [OIDC login, configure SSO, OpenID Connect, identity provider, OIDC setup]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/oidc.ts
    - src/app/api/auth/oidc/logout-url/route.ts
---

# Configure OIDC

## 2.0.0 support boundary

Supported: one configured OIDC provider for the workspace. Not supported:
multiple selectable identity providers on the sign-in screen. Keep local
break-glass access while changing the configured issuer.

## Before you begin

Obtain the issuer metadata and client credentials from the identity provider.

1. Configure the provider and callback settings in OpsKnight.
2. Test sign-in with a low-risk account and verify role and email policy.

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

## Provider and lifecycle checklist

- Perform issuer validation against the exact discovery issuer and use a stable
  identity key from the provider subject, not a display name.
- Decide whether first sign-in requires prior account linking or whether
  auto-provisioning is enabled. Test profile mapping and role mapping with a
  least-privileged account.
- For Microsoft Entra, Google Workspace, Okta, Auth0, and generic OIDC, follow
  the provider's application-registration steps while keeping OpsKnight's exact
  callback URL, issuer, scopes, and claim contract unchanged.
- Maintain a tested break-glass local administrator before enabling SSO-only
  access. Apply the documented session policy to both new and existing sessions.
- Treat issuer migration as an identity migration: pilot linking, confirm stable
  subjects, preserve emergency access, and only then retire the old issuer.

For troubleshooting, use [OIDC access problems](../../troubleshooting/login/oidc-access/).
