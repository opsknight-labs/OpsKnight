---
title: Product feature classification
description: Generated ownership and visibility classification for every discovered product surface.
type: reference
product_area: platform
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - generated/docs-discovery/current.json
    - generated/docs-contracts/current.json
---

# Product feature classification

Certification fails if any discovered node lacks an owner, classification, or
source. Public documentation is generated from public, administrator, and
operator contracts; internal nodes remain classified without becoming public
API promises.

- Total classified nodes: 1173
- Unclassified nodes: 0
- Evidence-backed generated claims: 1628
- Unsupported generated claims: 0
- Supported product nodes: 640
- Documented supported nodes: 640
- Undocumented supported nodes: 0
- Unresolved semantic contracts: 0

- `api`: 227
- `api-scope`: 7
- `authorization-action`: 9
- `configuration`: 317
- `deployment-topology`: 4
- `enum`: 73
- `integration`: 28
- `limit`: 228
- `model`: 120
- `notification-provider`: 9
- `permission`: 37
- `runtime-role`: 8
- `ui`: 101
- `worker-lane`: 5

## Classification totals

- `ADMIN_FEATURE`: 83
- `INTERNAL_IMPLEMENTATION`: 533
- `OPERATOR_FEATURE`: 346
- `PUBLIC_API`: 54
- `PUBLIC_FEATURE`: 157

The complete node-level contract, including provenance and extracted API
semantics, is stored in `generated/docs-contracts/current.json`.
