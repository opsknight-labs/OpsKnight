---
title: Identity provisioning and sign-in
order: 1
description: Configure OIDC authentication and SCIM user, team, and membership lifecycle.
type: concept
product_area: identity
audience: [administrator, operator]
verification: { level: source, verified_at: 2026-10-01, evidence: [src/lib/oidc, src/lib/scim.ts] }
---

# Identity provisioning and sign-in

Use [OIDC](./configure-oidc) for authentication and sign-in claims. Use
[SCIM](./configure-scim) for user lifecycle, teams, and team membership. Test
each integration with a pilot assignment before broad rollout, keep provider
identifiers stable, and document whether elevated roles come from OIDC claims
or manual administration. Preserve a break-glass account outside the automated
scope.
