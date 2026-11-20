---
title: Runbooks and safe remediation
description: Understand immutable workflows, service bindings, outbound Agents, risk-aware approval, execution semantics, and uncertain outcomes.
type: concept
product_area: runbooks
audience: [responder, administrator, operator]
verification:
  level: source
  verified_at: 2026-10-15
  evidence:
    [
      src/lib/runbooks/orchestrator.ts,
      src/lib/runbooks/agent-claims.ts,
      src/lib/runbooks/suggestion-plan.ts,
      prisma/schema.prisma,
    ]
---

# Runbooks and safe remediation

> **Beta** — Runbooks is Beta in v2.1. Qualify your deployment, Agent topology,
> and target permissions before enabling automatic writes in production.

A **Runbook** is an ordered, reusable incident-response workflow that captures
diagnostic, recovery, and verification steps in a single versioned definition.
Authors build and iterate on **drafts**; publishing produces an **immutable
version** with a SHA-256 checksum. A **service binding** (automation rule)
selects a published version, typed inputs, an execution target, and an
execution mode to connect the workflow to a specific service and its incidents.

## Architecture overview

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   Browser   │────▶│  Control Plane   │────▶│  Runbook Worker   │
│  (Author /  │     │  (API + Builder) │     │  (PostgreSQL job  │
│  Responder) │     │                  │     │   queue engine)   │
└─────────────┘     └──────┬───────────┘     └────────┬──────────┘
                           │                          │
                           │  Signed dispatch         │  Reconciliation
                           ▼                          ▼
                    ┌──────────────────┐     ┌───────────────────┐
                    │  Outbound Agent  │     │    PostgreSQL      │
                    │  (host / pod /   │     │  (executions,      │
                    │   container)     │     │   leases, nonces)  │
                    └──────────────────┘     └───────────────────┘
```

The **Control Plane** hosts the Runbook Builder, handles preview and approval,
and validates all inputs. The **Runbook Worker** plans, dispatches, and
reconciles executions using a durable PostgreSQL job queue. **Outbound Agents**
are deployed near execution targets (hosts, containers, Kubernetes clusters)
and perform allowlisted actions. Agents do not expose inbound command
endpoints — they poll the control plane for signed work.

## Workflow lifecycle

A Runbook progresses through these stages:

1. **Draft** — Author creates and iterates on steps, inputs, and configuration.
2. **Published** — An immutable version is created with a SHA-256 checksum of the
   canonical definition. Published versions cannot be edited.
3. **Bound** — A service automation rule connects the published version to a
   service with concrete input values, an execution target, and a trigger.
4. **Executed** — A responder (or automatic trigger) starts an execution that
   follows the frozen plan through dispatch, approval, action, and verification.
5. **Retired** — A published version can be retired from active use while
   preserving its audit history.

## Binding modes and versions

| Mode          | Behavior                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| **Manual**    | A responder starts the workflow from an incident. No trigger evaluation.                                        |
| **Suggested** | A matching incident-created trigger produces a suggestion; a responder decides whether to start it.             |
| **Automatic** | A matching trigger starts the workflow. Requires a pinned published version. Approval requirements still apply. |

**Latest-published** bindings follow future publications automatically. **Pinned**
bindings retain the chosen version. A suggestion freezes its resolved plan when
generated, so later binding edits do not silently change what an existing
suggestion starts.

Detaching a service rule **archives** and disables it. Historical suggestions
retain their rule and trigger identity, show **Rule detached**, and can be
dismissed; they cannot be previewed or executed. Pausing stops future dispatch
without canceling work that has already started.

## Risk model and approval

Risk is derived from **executable semantics**, not only an author's label:

| Risk class         | Meaning                                | Example actions                      |
| ------------------ | -------------------------------------- | ------------------------------------ |
| `READ_ONLY`        | Observes without changing target state | Diagnostics, inspect, status, health |
| `IDEMPOTENT_WRITE` | Changes state in a repeatable way      | Start, stop, scale                   |
| `NON_IDEMPOTENT`   | Cannot safely retry                    | Restart, Bash commands, POST/PATCH   |

The server enforces **minimum risk floors** per action type — authors cannot
make a restart safe by relabeling its risk. Non-idempotent actions always
require explicit approval. Approval is bound to the **exact resolved step plan
and digest**, including the version checksum, inputs, and target. It is not
blanket approval for future edits or unrelated steps.

## Target semantics

Use a **specific Agent** for machine-specific writes. A `LOCAL_HOSTS` pool
contains different machines; a multi-member pool cannot be used as an ambiguous
write target. A `SHARED_TARGET` pool is appropriate only when every member can
reach the same shared target. Pool membership alone does not grant platform
access.

## Execution model

Each execution follows a deterministic state machine:

```
QUEUED → RUNNING → WAITING_AGENT → WAITING_APPROVAL
                                         │
         ┌───────────────────────────────┘
         ▼
  SUCCEEDED │ FAILED │ TIMED_OUT │ CANCELLED │ CANCEL_REQUESTED
```

Steps within an execution proceed in order. Each step can have **prechecks**
(run before the action) and **verification** (run after). A failed precheck
prevents the action. Failed verification fails the remediation workflow even
when the action itself succeeded.

## Unknown outcomes

Loss of an Agent or its lease after a write starts can leave an **UNKNOWN**
step outcome. This does not mean the write failed or never ran. Inspect the
actual target before starting another execution. Cancellation requests stop
further work through reconciliation; they cannot undo an already-completed
write.

## Safety guarantees

OpsKnight's Runbook system enforces multiple safety boundaries:

- **Immutable versions** — Published workflows cannot be modified.
- **Cryptographic plan digest** — Approval is bound to the exact plan hash.
- **Signed execution envelopes** — Agents verify the control plane's signature
  before executing any step.
- **Replay protection** — Nonce-based request deduplication prevents replay attacks.
- **Remediation budgets** — Per-incident limits on automatic executions, writes,
  and non-idempotent actions.
- **Circuit breaker** — Repeated failures halt automatic execution and require
  human intervention.
- **Lease-based fencing** — Expired leases prevent stale Agents from reporting
  results as successful.

## Next steps

| Role              | Start here                                                                           |
| ----------------- | ------------------------------------------------------------------------------------ |
| **Author**        | [Author and publish a Runbook](../guides/runbooks/author)                            |
| **Responder**     | [Bind to services and respond to incidents](../guides/runbooks/respond)              |
| **Administrator** | [Manage Agents, pools, and secrets](../guides/runbooks/agents-pools-secrets)         |
| **Operator**      | [Install and operate outbound Agents](../operate/deploy/agent-operations)            |
| **Reference**     | [Runbook reference](../reference/runbooks) — step types, inputs, permissions, limits |
