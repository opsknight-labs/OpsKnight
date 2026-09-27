---
title: Authentication
description: Local sessions and external identity boundaries.
type: concept
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/oidc.ts, src/lib/auth.ts]
---

# Authentication

Authentication establishes identity; authorization decides what that identity
may do. Deployment trust boundaries, session controls, and external identity
configuration must be evaluated together.

Local credentials support bootstrap and controlled fallback. OIDC delegates
authentication to an identity provider, while SCIM manages user lifecycle; one
does not automatically configure the other. Email matching, issuer and audience
validation, redirect URLs, session lifetime, and secure cookies are part of the
trust contract.

Keep a tested recovery administrator outside the normal federation failure
path, protect it as a break-glass identity, and audit its use. See the
[OIDC](../guides/identity/configure-oidc) and [SCIM](../guides/identity/configure-scim) guides.
