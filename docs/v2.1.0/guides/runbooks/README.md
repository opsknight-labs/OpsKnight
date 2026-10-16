---
title: Runbooks
order: 1
description: Author reusable workflows, bind them to services, respond to incidents, and manage execution infrastructure.
type: concept
product_area: runbooks
audience: [responder, administrator, operator]
verification:
  level: source
  verified_at: 2026-10-15
  evidence: [src/app/(app)/runbooks, src/components/service/ServiceRunbooks.tsx, src/components/incident/IncidentRunbooks.tsx]
---

# Runbooks

Runbooks is **Beta** in v2.1. Use a published, compatible server/Agent pair
and qualify your deployment and target permissions before enabling automatic
writes. Passing configuration checks or a preview does not prove recovery.

Read [Runbooks and safe remediation](../../concepts/runbooks) before enabling writes.

1. [Author and publish a Runbook](./author).
2. [Bind a workflow and respond to an incident](./respond).
3. [Manage Agents, pools, and scoped secrets](./agents-pools-secrets).
4. [Install and operate outbound Agents](../../operate/deploy/agent-operations).
5. [Troubleshoot execution and Agent health](../../troubleshooting/runbooks/).
6. [Configure action examples and local policy](./examples).

Use [Runbook reference](../../reference/runbooks) for step types, input types,
permissions, and limits. Begin with diagnostics and a manual binding before
introducing approved writes or automatic triggers.

## Choose your starting point

Responders should read the incident execution guide, including exact-plan
approval, detached suggestions and uncertain outcomes. Authors should begin
with a read-only workflow and publish an immutable version. Operators should
complete Agent installation, inspect effective capabilities and local policy,
and monitor durable worker evidence before enabling a service rule.

For API integrations, see the [v2 API reference](../../reference/api/v2).
Bound executions use the rule's saved inputs; request parameters cannot override
them. The [Runbook reference](../../reference/runbooks) documents maintenance
limits and the distinction between measured checks and release qualification.

For staged enterprise qualification, physical target tests and authenticated HTTP
measurements, follow [Runbook qualification](../../operate/deploy/runbook-qualification).
