---
title: Product feature classification
description: Generated ownership and visibility classification for every discovered product surface.
type: reference
product_area: platform
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-10-27
  evidence:
    - generated/docs-discovery/current.json
    - generated/docs-contracts/current.json
---

# Product feature classification

Certification fails if any discovered node lacks an owner, classification, or
source. Public documentation is generated from public, administrator, and
operator contracts; internal nodes remain classified without becoming public
API promises.

- Total classified nodes: 1983
- Unclassified nodes: 0
- Evidence-backed generated claims: 2795
- Unsupported generated claims: 0
- Supported product nodes: 851
- Documented supported nodes: 851
- Undocumented supported nodes: 0
- Unresolved semantic contracts: 0

- `api`: 475
- `api-scope`: 73
- `authorization-action`: 82
- `configuration`: 519
- `deployment-topology`: 4
- `enum`: 93
- `integration`: 28
- `limit`: 337
- `model`: 178
- `notification-provider`: 9
- `permission`: 52
- `runtime-role`: 8
- `ui`: 119
- `worker-lane`: 6

## Classification totals

- `ADMIN_FEATURE`: 172
- `INTERNAL_IMPLEMENTATION`: 1132
- `OPERATOR_FEATURE`: 370
- `PUBLIC_API`: 121
- `PUBLIC_FEATURE`: 188

The complete node-level contract, including provenance and extracted API
semantics, is stored in `generated/docs-contracts/current.json`.
