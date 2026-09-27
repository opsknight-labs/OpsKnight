---
title: Harden an OpsKnight deployment
description: Establish identity, network, secret, and runtime security boundaries.
type: deployment
product_area: security
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/network-security.ts
    - src/lib/encryption-key-validation.ts
---

# Harden an OpsKnight deployment

Use unique high-entropy session and encryption keys, HTTPS at the external edge,
and explicit trusted-proxy settings. Restrict database, metrics, deep health, and
administrative routes to intended networks and identities. Run containers without
unnecessary capabilities and keep ServiceAccount permissions minimal.

Encrypt provider credentials, rotate them at both systems after exposure, review
role and API-key scope, validate webhook signatures, and retain audit evidence.
Test denied paths as well as successful paths.

