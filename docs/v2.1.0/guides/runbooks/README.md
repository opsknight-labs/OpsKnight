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
  evidence:
    [
      src/app/(app)/runbooks,
      src/components/service/ServiceRunbooks.tsx,
      src/components/incident/IncidentRunbooks.tsx,
    ]
---

# Runbooks

> **Beta** — Runbooks is Beta in v2.1. Use a published, compatible server/Agent
> pair and qualify your deployment and target permissions before enabling
> automatic writes. Passing configuration checks or a preview does not prove
> recovery.

Read [Runbooks and safe remediation](../../concepts/runbooks) for the
architecture, risk model, and safety guarantees before enabling writes.

## Guides

| #   | Guide                                                | Audience           | What you'll learn                                                                                                             |
| --- | ---------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Author and publish](./author)                       | Authors, Admins    | Create drafts, configure all 9 step types, define typed inputs, manage prechecks and verification, publish immutable versions |
| 2   | [Bind and respond](./respond)                        | Admins, Responders | Attach workflows to services, configure triggers, preview and approve exact plans, handle cancellation and uncertain outcomes |
| 3   | [Agents, pools, and secrets](./agents-pools-secrets) | Admins, Operators  | Enroll Agents, choose pool semantics, grant and rotate scoped secrets, monitor fleet health                                   |
| 4   | [Permissions and security](./permissions)            | Admins             | All 9 capabilities, API scopes, service authorization, artifact access                                                        |
| 5   | [Action examples](./examples)                        | Authors, Operators | Kubernetes recovery, Docker inspection, systemd checks, HTTP verification, static Bash commands                               |
| 6   | [Health and monitoring](./health)                    | Operators          | Health dashboard, circuit breaker, remediation budgets, Prometheus alerts, worker evidence                                    |
| 7   | [Service bindings and triggers](./service-bindings)  | Admins             | Automatic activation, trigger conditions, concurrent edits, rule lifecycle                                                    |

## Reference and operations

- [Runbook reference](../../reference/runbooks) — Step types, input types,
  risk classes, permissions, limits, state machines, and maintenance.
- [Agent operations](../../operate/deploy/agent-operations) — Installation,
  deployment topologies, and upgrade procedures.
- [Enterprise qualification](../../operate/deploy/runbook-qualification) —
  Correctness, physical target, fault, and load receipts.
- [Troubleshooting](../../troubleshooting/runbooks/) — Waiting executions,
  unavailable Agents, uncertain outcomes, and common errors.

## Choose your starting point

| If you are a…                               | Start with…                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responder** new to Runbooks               | Read the [concepts](../../concepts/runbooks), then [Bind and respond](./respond) for incident execution, exact-plan approval, detached suggestions, and uncertain outcomes |
| **Author** creating your first workflow     | [Author and publish](./author) — start with a read-only diagnostics workflow                                                                                               |
| **Administrator** setting up infrastructure | [Agents, pools, and secrets](./agents-pools-secrets) → [Permissions](./permissions) → [Service bindings](./service-bindings)                                               |
| **Operator** deploying Agents               | [Agent operations](../../operate/deploy/agent-operations) → [Health](./health) → [Enterprise qualification](../../operate/deploy/runbook-qualification)                    |
| **API integrator**                          | [v2 API reference](../../reference/api/v2) — bound executions use saved inputs; request parameters cannot override them                                                    |

Begin with diagnostics and a manual binding before introducing approved writes
or automatic triggers.
