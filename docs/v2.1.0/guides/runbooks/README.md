---
title: Runbooks
order: 1
description: Author reusable workflows, bind them to services, respond to incidents, and manage execution infrastructure.
type: concept
product_area: runbooks
audience: [responder, administrator, operator]
verification:
  level: source
  verified_at: 2026-10-04
  evidence: [src/app/(app)/runbooks, src/components/service/ServiceRunbooks.tsx, src/components/incident/IncidentRunbooks.tsx]
---

# Runbooks

Read [Runbooks and safe remediation](../../concepts/runbooks) before enabling writes.

1. [Author and publish a Runbook](./author).
2. [Bind a workflow and respond to an incident](./respond).
3. [Manage Agents, pools, and scoped secrets](./agents-pools-secrets).
4. [Install and operate outbound Agents](../../operate/deploy/agent-operations).
5. [Troubleshoot execution and Agent health](../../troubleshooting/runbooks/).

Use [Runbook reference](../../reference/runbooks) for step types, input types,
permissions, and limits. Begin with diagnostics and a manual binding before
introducing approved writes or automatic triggers.
