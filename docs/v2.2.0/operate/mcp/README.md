---
title: Operating MCP
order: 1
description: Architecture, certification evidence and parity planning for the OpsKnight MCP server.
type: concept
product_area: mcp
audience: [operator, developer]
verification:
  level: source
  verified_at: 2026-11-04
  evidence:
    - src/app/mcp/route.ts
---

# Operating MCP

- [Architecture and threat model](architecture.md): authentication, authorization, workload isolation and outstanding work.
- [Monitoring and capacity](monitoring.md): every MCP metric, the shipped alerts, the per-request log line, sizing per replica and the `MCP_FORCE_DISABLED` emergency stop.
- [Threat model, data flow and control matrix](../../../security/mcp-threat-model.md): what the MCP server protects, the threats considered, the controls that answer them with their evidence, and the residual risks. Not an independent assessment.
- [Service-account design (proposal)](../../../security/mcp-service-accounts-design.md): a non-human identity for headless agents, for sign-off before any code.
- [Certification status](certification.md): what is and is not certified, and how release evidence is collected.
- [Exclusion review packet](exclusion-review.md): open operations with proposed dispositions.
- [Full-parity delivery](full-parity.md): the parity plan and acceptance criteria.
- [Contributing to MCP](contributing.md): local checks, manual OAuth and protocol calls, and the reviewed workflows, for people working on OpsKnight itself.

To set MCP up, see the [self-hosted setup guide](../../guides/mcp/self-hosted-setup.md).
