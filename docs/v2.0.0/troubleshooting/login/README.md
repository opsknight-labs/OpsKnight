---
title: Troubleshoot login and access
description: Diagnose successful identity-provider login with incorrect OpsKnight access.
type: concept
product_area: identity
audience: [administrator, operator]
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/auth.ts] }
---

# Troubleshoot login and access

Use [OIDC login succeeds but access is wrong](./oidc-access) when authentication succeeds but membership, role, team, or authorization is unexpected. Compare the provider claims, normalized email, provisioning state, group/role mapping, and OpsKnight audit event without exposing tokens.
