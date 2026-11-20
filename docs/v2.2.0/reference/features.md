---
title: Product feature classification
description: Generated ownership and visibility classification for every discovered product surface.
type: reference
product_area: platform
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-11-20
  evidence:
    - generated/docs-discovery/current.json
    - generated/docs-contracts/current.json
---

# Product feature classification

Certification fails if any discovered node lacks an owner, classification, or
source. Public documentation is generated from public, administrator, and
operator contracts; internal nodes remain classified without becoming public
API promises.

- Total classified nodes: 2355
- Unclassified nodes: 0
- Evidence-backed generated claims: 3315
- Unsupported generated claims: 0
- Supported product nodes: 951
- Documented supported nodes: 951
- Undocumented supported nodes: 0
- Unresolved semantic contracts: 0

- `api`: 492
- `api-scope`: 73
- `authorization-action`: 85
- `configuration`: 692
- `deployment-topology`: 4
- `enum`: 101
- `integration`: 28
- `limit`: 468
- `model`: 205
- `notification-provider`: 9
- `permission`: 54
- `runtime-role`: 8
- `ui`: 130
- `worker-lane`: 6

## Classification totals

- `ADMIN_FEATURE`: 185
- `INTERNAL_IMPLEMENTATION`: 1404
- `OPERATOR_FEATURE`: 438
- `PUBLIC_API`: 122
- `PUBLIC_FEATURE`: 206

The complete node-level contract, including provenance and extracted API
semantics, is stored in `generated/docs-contracts/current.json`.
