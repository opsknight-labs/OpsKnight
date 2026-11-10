---
title: OpsKnight 2.2.0 documentation
description: Documentation for the upcoming OpsKnight 2.2.0 release, including AI assistants (MCP) and single sign-on.
type: concept
product_area: documentation
audience:
  - operator
  - administrator
verification:
  level: source
  verified_at: 2026-11-05
  evidence: [docs/versions.json, docs/v2.2.0/capabilities.yaml]
---

# OpsKnight 2.2.0 documentation

This is the documentation for the upcoming **OpsKnight 2.2.0** release.
`v2.2.0` is the `upcomingVersion` in `docs/versions.json`; it is not yet listed in
`releasedVersions`, so the release-gated documentation sync does not publish it.
Pages for features unchanged since 2.1.0 remain in the [2.1.0 documentation](../v2.1.0/README.md).

## AI assistants (MCP)

- [Overview](./guides/mcp/README.md) and [self-hosted setup](./guides/mcp/self-hosted-setup.md)
- [What to ask](./guides/mcp/what-to-ask.md), [build an agent](./guides/mcp/build-an-agent.md) and
  [security and data](./guides/mcp/security-and-data.md)
- [Troubleshooting](./guides/mcp/troubleshooting.md), [permissions and coverage](./reference/mcp/permissions.md)
  and the [tool reference](./reference/mcp/tools.md)
- Operating: [architecture](./operate/mcp/architecture.md), [monitoring](./operate/mcp/monitoring.md)
  and [certification status](./operate/mcp/certification.md)

## Intelligence (AIOps)

- [Use suggestions](./guides/intelligence/use-suggestions.md) and [basic-mode questions](./guides/intelligence/basic-mode.md)
- [AIOps overview](./guides/intelligence/aiops-overview.md), [intelligence on incidents and lists](./guides/intelligence/incidents-and-lists.md)
  and [noise-control builders](./guides/intelligence/noise-control-builders.md)
- Operating: [production guide](./operate/intelligence/production.md)

## Identity

- [Single sign-on guides](./guides/identity/README.md) and [sign-in troubleshooting](./troubleshooting/login/README.md)
