---
title: Runbooks and safe remediation
description: Understand immutable workflows, service bindings, outbound Agents, exact-plan approval, and uncertain execution outcomes.
type: concept
product_area: runbooks
audience: [responder, administrator, operator]
verification:
  level: source
  verified_at: 2026-10-04
  evidence: [src/lib/runbooks/orchestrator.ts, src/lib/runbooks/agent-claims.ts, src/lib/runbooks/suggestion-plan.ts, prisma/schema.prisma]
---

# Runbooks and safe remediation

A Runbook is an ordered, reusable incident-response workflow. Authors edit
drafts; publishing produces an immutable version. A service binding selects
a published version, typed inputs, an execution target, and an execution mode.
An execution retains its version checksum, resolved inputs, target, and step history.

The Runbook Worker plans and reconciles executions in PostgreSQL. An outbound
Agent performs allowlisted host, container, or Kubernetes actions near the target.
The Agent does not expose an inbound command endpoint. Local policy, platform
permissions, capabilities, signed execution envelopes, and leases all constrain execution.

## Binding modes and versions

- **Manual:** a responder starts the workflow from an incident.
- **Suggested:** a matching incident-created trigger produces a suggestion;
  a responder decides whether to start it.
- **Automatic:** a matching trigger starts the workflow; the binding must use
  a pinned published version. Approval requirements still apply.

Latest-published bindings follow future publications; pinned bindings retain
the chosen version. A suggestion freezes its resolved plan when generated,
so later binding edits do not silently change what an existing suggestion starts.

## Risk and approval

Risk is derived from executable semantics, not only an author's label.
Read-only actions observe a target. Idempotent writes change it in a repeatable
way. Non-idempotent actions, including service restarts and Bash commands,
require approval. Approval is bound to the exact resolved step plan and digest,
including its version checksum, inputs, and target; it is not blanket approval
for future edits or unrelated steps.

## Target semantics

Use a specific Agent for machine-specific writes. A `LOCAL_HOSTS` pool contains
different machines; a multi-member pool cannot be used as an ambiguous write
target. A `SHARED_TARGET` pool is appropriate only when every member can reach
the same shared target. Pool membership alone does not grant platform access.

## Unknown outcomes

Loss of an Agent or its lease after a write starts can leave an **UNKNOWN**
step outcome. This does not mean the write failed or never ran. Inspect the
actual target before starting another execution. Cancellation requests stop
further work through reconciliation; they cannot undo an already completed write.

Start with [authoring](../guides/runbooks/author), then
[service bindings and incident execution](../guides/runbooks/respond).
Operators should also read [Agent installation](../operate/deploy/agent-operations).
