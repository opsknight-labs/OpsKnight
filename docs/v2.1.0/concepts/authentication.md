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

Keep a tested recovery administrator outside the normal federation failure
path, protect it as a break-glass identity, and audit its use. Dedicated emergency
principals and a restricted recovery console are still outstanding. An imported
legacy emergency password identity remains an ordinary User, with a one-hour
maximum and a 15-minute idle timeout. It does not establish the two independent
WebAuthn identities needed before new Required activation can become available.
See [authentication modes](../guides/identity/authentication-modes/) and the
[OIDC](../guides/identity/configure-oidc) and [SCIM](../guides/identity/configure-scim) guides.
