---
title: OpsKnight 2.0.0 documentation
description: Documentation workspace for the upcoming OpsKnight 2.0.0 release.
type: concept
product_area: documentation
audience:
  - operator
  - administrator
verified: false
---

# OpsKnight 2.0.0 documentation

This is the documentation workspace for the upcoming **OpsKnight 2.0.0**
release. It is not published by the release-gated documentation sync until
`v2.0.0` is added to `releasedVersions` in `docs/versions.json`.

The 2.0.0 documentation is rebuilt from current product evidence. Historical
documentation can help locate a topic, but it is never authoritative.

## Evidence order

When sources conflict, use this order:

1. Current executable behavior
2. Current tests
3. Current source code and configuration
4. Historical documentation

Documentation must not claim behavior that cannot be verified against one of
the first three sources.

## Planned sections

- **Start** — install OpsKnight and complete a first incident.
- **Concepts** — understand the product model and why it behaves as it does.
- **Guides** — complete responder and administrator tasks.
- **Integrations** — connect alert sources and collaboration systems.
- **Operate** — deploy, secure, scale, back up, and upgrade OpsKnight.
- **Reference** — exact API, configuration, permission, and runtime contracts.
- **Troubleshooting** — diagnose symptoms using observable evidence.
- **Develop** — build, test, and contribute to OpsKnight.
