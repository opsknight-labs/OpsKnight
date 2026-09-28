---
title: Product feature classification
description: Generated ownership and visibility classification for every discovered product surface.
type: reference
product_area: platform
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence:
    - generated/docs-discovery/current.json
    - generated/docs-contracts/current.json
---

# Product feature classification

Certification fails if any discovered node lacks an owner, classification, or
source. Public documentation is generated from public, administrator, and
operator contracts; internal nodes remain classified without becoming public
API promises.

- Total classified nodes: 1094
- Unclassified nodes: 0
- Evidence-backed generated claims: 1539
- Unsupported generated claims: 0

- `api`: 219
- `api-scope`: 7
- `authorization-action`: 9
- `configuration`: 248
- `deployment-topology`: 4
- `enum`: 73
- `integration`: 28
- `limit`: 226
- `model`: 120
- `notification-provider`: 9
- `permission`: 37
- `runtime-role`: 8
- `ui`: 101
- `worker-lane`: 5

## Classification totals

- `ADMIN_FEATURE`: 83
- `INTERNAL_IMPLEMENTATION`: 355
- `OPERATOR_FEATURE`: 494
- `PUBLIC_API`: 47
- `PUBLIC_FEATURE`: 115

The complete node-level contract, including provenance and extracted API
semantics, is stored in `generated/docs-contracts/current.json`.
