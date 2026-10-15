---
title: Troubleshoot Runbooks
description: Diagnose waiting executions, unavailable Agents, confidential transport errors, ambiguous targets, and uncertain outcomes safely.
type: troubleshooting
product_area: runbooks
audience: [responder, administrator, operator]
verification:
  level: source
  verified_at: 2026-10-15
  evidence:
    [
      src/lib/runbooks/agent-claims.ts,
      src/lib/runbooks/reconciler.ts,
      src/app/(app)/runbooks/health/page.tsx,
      agent/src/lease.ts,
    ]
---

# Troubleshoot Runbooks

Begin with the incident execution timeline and **Runbooks → Health**. Record
the execution/version, affected step, target, timestamps, and error code without
including secret values or enrollment tokens.

## Waiting for approval

Check that the responder has `runbook.approve` and access to the incident.
Inspect the resolved plan before approving. A changed-plan error requires
reviewing the current plan; do not bypass the digest check or reuse old approval.

## Waiting for an Agent

Check the binding's resolved target, Agent heartbeat, configured capabilities,
local policy, and platform permissions. Confirm it is not revoked. For a pool,
check membership and shared-target assumptions. Review Agent errors and control-plane
connectivity. Do not remove policy restrictions merely to make a claim succeed.

## HTTPS required for secret-backed steps

Configure the Agent with a trusted HTTPS control-plane URL. Verify certificate
trust, ingress/TLS termination, and correct trusted-proxy configuration. Check
the secret reference and Agent/pool grant. Do not replace a secret reference
with plaintext or spoof proxy headers as a workaround.

## Ambiguous LOCAL_HOSTS write target

A multi-member local-host pool represents multiple machines. Change the service
binding to a specific Agent. Only use a shared-target pool when its members
genuinely operate the same shared target; relabeling a pool is not a safety fix.

## UNKNOWN outcome or lost lease

Inspect the actual target before any retry. An uncertain write may already have
executed. Preserve logs and durable Agent state, including identity and spool.
Do not delete the identity volume to clear an error. Cancellation is a request,
not a rollback or proof that the write did not execute.

## Spool or worker attention

Check pending results, dead letters, reported errors, storage availability,
and connectivity. Follow [Agent operations](../../operate/deploy/agent-operations)
for spool recovery. In split deployments, inspect the Runbook Worker readiness
and logs separately: web-process status is not fleet-wide worker health.

## JSON edits did not save

Apply Advanced JSON to the builder before saving. The unapplied-changes warning
blocks saving across tabs. Refresh JSON from the builder only if you intend to
discard unapplied edits. Publishing publishes the saved draft, not unsaved editor contents.

## Preview changed or prerequisites are blocked

`PREVIEW_STALE` means the immutable version selection, resolved inputs, target,
or planned actions changed after preview. Generate a fresh preview and review
it before executing. A blocked capability/secret check prevents execution from
the preview panel; check Agent heartbeat, capabilities and the target's current
grants. A passing check can change before dispatch, which always rechecks live
policy and secret authority.

## Use the execution evidence

The execution detail page shows step and attempt status, queue time, recorded
claim time, start/completion, claimed Agent, target, lease expiry, approval
identity/digest, bounded output and artifacts. Attempts created before claim-time
recording was introduced display an unknown claim time. Troubleshooting guidance
separates configuration errors, policy rejection, infrastructure failures,
verification failure and uncertain writes. A failed verification does not undo a
write; inspect the observed target state before repeating remediation.

## Setup and worker evidence

If installation commands cannot be copied, review the verified release manifest, confirmed Agent-reachable HTTPS URL and token expiry. Missing release assets cannot be repaired with a guessed installer URL. Revoke the enrollment and create a fresh token if it expired or was abandoned. A consumed token is not a substitute for a lost private identity.

For UNKNOWN worker health, inspect durable worker heartbeats, deploy/run the runbook lane and scheduler, and confirm successful dispatch and reconciliation within 90 seconds. An empty queue is insufficient evidence. For Agent readiness failures, inspect clock, authentication, durable storage and drain reasons; liveness should remain healthy while the process makes progress. Restore the dependency before retrying. Never replay an uncertain started write automatically.

## A rule save conflicts or a suggestion cannot execute

A configuration revision conflict means someone changed the rule after you
loaded it. Reload, review the saved version and reapply the intended changes.
A successful trigger save affects future incident events; it does not rewrite
historical suggestions.

**Rule detached** retains the suggestion for history and disables preview and
execution. Dismiss it if no longer useful. Paused rules also cannot start their
suggestions until reactivated. Detach archives the rule instead of deleting its
historical trigger, suggestion and execution identity.

For v2 API execution, a non-empty `parameters` object with a resolved rule returns
HTTP 400 `RUNBOOK_DEFINITION_INVALID`. Omit those parameters and use the rule's
saved inputs, or deliberately execute an unbound workflow with validated inputs.
See [service rules and incident response](../../guides/runbooks/respond).

## Replay nonce maintenance is falling behind

Inspect the [nonce purge metrics and limits](../../reference/runbooks#bounded-nonce-maintenance)
alongside database latency, lock contention and worker logs. Purging runs in a
separate one-connection maintenance pool; each batch selects at most 1,000
expired IDs, and slow batches do not overlap. Artifact retention shares this
pool but keeps its own one-minute cadence.

A rising oldest-expired-age gauge or failed-batch counter calls for database and
maintenance-throughput investigation. Skipped or failed batches preserve the
last successful age observation, so pair the gauge with counters and logs.
Do not truncate the nonce table to clear a backlog: recent rows protect against
replay inside the signature window. Agent clock or authentication failures
require correcting time synchronization or identity, rather than weakening the
signature window or disabling replay checks.
