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

Start with [authentication modes](./authentication-modes/), then
[migrate the existing administrator](./migrate-admin-to-sso/) without changing its
User ID. [Configure independent emergency access](./configure-emergency-access/)
and [test and enforce SSO](./test-and-enforce-sso/) after a staged login test.
Use [credential rotation](./rotate-oidc-credentials/) for tested provider changes
and [lockout recovery](./sso-lockout-recovery/) during an IdP outage. Emergency
recovery needs PostgreSQL and never silently enables password fallback.

For existing installations, follow [Upgrade existing SSO](./upgrade-existing-sso/)
for preserved login behavior, controlled cutover and migration acceptance checks.

Use [Local certification and failure rehearsal](./local-certification/) to reproduce
upgrade, concurrency, deployment-cutover and recovery checks.
