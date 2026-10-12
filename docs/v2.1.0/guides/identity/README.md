---
title: Identity provisioning and sign-in
order: 1
description: Configure OIDC authentication and SCIM user, team, and membership lifecycle.
type: concept
product_area: identity
audience: [administrator, operator]
verification: { level: source, verified_at: 2026-10-12, evidence: [src/lib/oidc, src/lib/scim.ts] }
---

# Identity provisioning and sign-in

Use [OIDC](./configure-oidc) for authentication and sign-in claims. Use
[SCIM](./configure-scim) for user lifecycle, teams, and team membership. Test
each integration with a pilot assignment before broad rollout, keep provider
identifiers stable, and document whether elevated roles come from OIDC claims
or manual administration.

Start with [authentication modes](./authentication-modes/) before introducing SSO.
Configure the provider while password login remains available, choose SSO Optional,
approve the existing administrator's first identity link, and test a real login in
a separate browser session. The original User ID and operational history remain
intact. New SSO Required activation is unavailable until dedicated independent
emergency recovery and verified administrator readiness are implemented and tested.
