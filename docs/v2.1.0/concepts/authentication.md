---
title: Authentication
description: Local sessions and external identity boundaries.
type: concept
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-12
  evidence: [src/lib/oidc.ts, src/lib/auth.ts]
---

# Authentication

Authentication establishes identity; authorization decides what that identity
may do. Deployment trust boundaries, session controls, and external identity
configuration must be evaluated together.

Local credentials support bootstrap and explicitly permitted password sign-in. OIDC delegates
authentication to an identity provider, while SCIM manages user lifecycle; one
does not automatically configure the other. Email matching, issuer and audience
validation, redirect URLs, session lifetime, and secure cookies are part of the
trust contract. Normal SSO sign-in never falls back to password authentication
when the provider is unavailable under SSO Required.

PostgreSQL stores a versioned singleton AuthenticationPolicy. Credential login,
OIDC sign-in, password operations and server session evaluation consult its
authoritative state. Policy changes and their audit event commit atomically;
password writes lock the same policy row to serialize enforcement. Sessions carry
their authentication method and immutable issuing-policy version. Persistent
revocation cutoffs prevent old sessions reviving when a mode is relaxed later.
The Edge middleware's cookie check is a routing hint, not policy authorization.
Protected server requests and long-lived stream authorization checks enforce policy.

The legacy environment controls are imported once under a PostgreSQL advisory
lock. Database failure or loss of an already-imported policy fails authentication
closed; changing deployment variables cannot bypass this boundary. This requires
an external PostgreSQL recovery procedure during a database outage.

Keep two independently held hardware-key emergency identities outside the
federation failure path. Dedicated emergency principals open a restricted recovery
console and never create ordinary User sessions. Successful drills verify current
credential versions; enrollment alone is insufficient. Their hard maximum is one
hour, idle timeout 15 minutes, and sensitive actions require a fresh five-minute
proof. Imported emergency passwords are a recovery-only bridge to retire after
two independent drills. PostgreSQL is required for both ordinary and emergency
authentication. See [Emergency Access](../guides/identity/configure-emergency-access/).
See [authentication modes](../guides/identity/authentication-modes/) and the
[OIDC](../guides/identity/configure-oidc) and [SCIM](../guides/identity/configure-scim) guides.
