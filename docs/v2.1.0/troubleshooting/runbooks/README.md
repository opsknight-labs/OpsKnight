---
title: Troubleshoot Runbooks
description: Diagnose waiting executions, unavailable Agents, confidential transport errors, ambiguous targets, uncertain outcomes, and common configuration problems.
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
the execution/version, affected step, target, timestamps, and error code
without including secret values or enrollment tokens.

## Execution is waiting for approval

**Symptoms**: Step status shows `WAITING_APPROVAL`.

**Diagnosis**:

1. Check that the responder has `runbook.approve` and access to the incident.
2. Inspect the resolved plan before approving.

**Resolution**:

- If the responder has permission, inspect and approve the exact plan.
- A changed-plan error requires reviewing the current plan; do not bypass the
  digest check or reuse old approval.
- If the circuit breaker has been triggered, the execution requires human
  approval regardless of the original configuration.

## Execution is waiting for an Agent

**Symptoms**: Step status shows `WAITING_AGENT`.

**Diagnosis**:

1. Check the binding's resolved target.
2. Check Agent heartbeat (must be within 90 seconds).
3. Check configured vs. effective capabilities.
4. Check local policy and platform permissions.
5. Confirm Agent is not revoked.
6. For a pool, check membership and shared-target assumptions.

**Resolution**:

- Review Agent errors and control-plane connectivity.
- Do not remove policy restrictions merely to make a claim succeed.
- Ensure the Agent's effective capabilities include the required step type.

## HTTPS required for secret-backed steps

**Symptoms**: Execution fails with confidential transport error.

**Diagnosis**:

1. Check the Agent's control-plane URL configuration.
2. Verify HTTPS is being used (not HTTP).
3. Verify certificate trust on the Agent host.

**Resolution**:

- Configure the Agent with a trusted HTTPS control-plane URL.
- Verify certificate trust, ingress/TLS termination, and correct
  trusted-proxy configuration.
- Check the secret reference and Agent/pool grant.
- Do **not** replace a secret reference with plaintext or spoof proxy headers.

## Ambiguous LOCAL_HOSTS write target

**Symptoms**: Write fails because target is ambiguous.

**Diagnosis**: A multi-member `LOCAL_HOSTS` pool represents multiple machines
and cannot determine which should execute the write.

**Resolution**:

- Change the service binding to target a **specific Agent**.
- Only use a `SHARED_TARGET` pool when its members genuinely operate the same
  shared target.
- Relabeling a pool mode is not a safety fix.

## UNKNOWN outcome or lost lease

**Symptoms**: Step shows `UNKNOWN` status.

**Cause**: The Agent lost contact or its lease expired after a write started.
The write may or may not have executed.

**Resolution**:

1. **Inspect the actual target** before any retry — the write may have
   already executed.
2. Preserve logs and durable Agent state, including identity and spool.
3. Do **not** delete the identity volume to clear an error.
4. Cancellation is a request, not a rollback or proof that the write did not
   execute.

## Spool or worker attention required

**Symptoms**: Health page shows spool depth, dead letters, or worker issues.

**Diagnosis**:

1. Check pending results and dead letters on the Agent.
2. Check storage availability on the Agent host.
3. Check Agent connectivity to control plane.

**Resolution**:

- Follow [Agent operations](../../operate/deploy/agent-operations) for spool
  recovery.
- In split deployments, inspect the Runbook Worker readiness and logs
  separately — web-process status is not fleet-wide worker health.

## JSON edits did not save

**Symptoms**: Changes made in Advanced JSON editor are lost.

**Cause**: JSON was not applied to the builder before saving.

**Resolution**:

1. Apply Advanced JSON to the builder **before** saving.
2. The unapplied-changes warning blocks saving across tabs.
3. Refresh JSON from the builder only if you intend to discard unapplied
   edits.
4. Publishing publishes the **saved draft**, not unsaved editor contents.

## Preview changed or prerequisites are blocked

**Symptoms**: `PREVIEW_STALE` error or blocked capability/secret check.

### PREVIEW_STALE

The immutable version selection, resolved inputs, target, or planned actions
changed after preview. Generate a fresh preview and review it before executing.

### Blocked prerequisites

A blocked capability/secret check prevents execution from the preview panel:

1. Check Agent heartbeat and capabilities.
2. Check the target's current secret grants.
3. A passing check can change before dispatch, which always rechecks live
   policy and secret authority.

## A rule save conflicts

**Symptoms**: Error when saving rule configuration.

**Cause**: A configuration revision conflict — someone changed the rule after
you loaded it.

**Resolution**:

1. Reload the page.
2. Review the saved version.
3. Reapply your intended changes.
4. A successful trigger save affects future incident events only.

## A suggestion cannot execute

**Symptoms**: Suggestion shows but preview/execution are disabled.

### Rule detached

- The suggestion is retained for history with **Rule detached** label.
- Preview and execution are disabled.
- Dismiss it if no longer useful.

### Rule paused

- Paused rules cannot start their suggestions until reactivated.
- Detach archives the rule instead of deleting its historical identity.

## v2 API execution returns HTTP 400

**Symptoms**: `RUNBOOK_DEFINITION_INVALID` error from API.

**Cause**: A non-empty `parameters` object was sent with a resolved rule.

**Resolution**:

- Omit `parameters` or send `{}` for bound executions.
- Use the rule's saved inputs.
- Or deliberately execute an unbound workflow with validated inputs.

## Replay nonce maintenance is falling behind

**Symptoms**: Rising oldest-expired-age gauge or failed-batch counter.

**Diagnosis**:

1. Inspect [nonce purge metrics](../../reference/runbooks#bounded-nonce-maintenance).
2. Check database latency, lock contention, and worker logs.
3. Purging runs in a separate one-connection maintenance pool; slow batches
   do not overlap.

**Resolution**:

- Investigate database and maintenance throughput.
- Skipped or failed batches preserve the last successful age observation.
- Do **not** truncate the nonce table — recent rows protect against replay.
- Agent clock or authentication failures require correcting time
  synchronization or identity, not weakening the signature window.

## Setup commands cannot be copied

**Symptoms**: Installation page does not show commands.

**Cause**: Missing verified release manifest, unconfirmed Agent-reachable
HTTPS URL, or expired token.

**Resolution**:

- Review the verified release manifest.
- Confirm Agent-reachable HTTPS URL.
- If the token expired or was abandoned, revoke the enrollment and create a
  fresh token.
- A consumed token cannot substitute for a lost private identity.

## Worker health shows UNKNOWN

**Symptoms**: Health page shows UNKNOWN worker status.

**Diagnosis**:

1. Inspect durable worker heartbeats in the database.
2. Check if the Runbook lane and scheduler are deployed and running.
3. Confirm successful dispatch and reconciliation within 90 seconds.

**Resolution**:

- An empty queue alone is insufficient evidence of health.
- Deploy or restart the Runbook Worker.
- For Agent readiness failures, inspect clock, authentication, durable
  storage, and drain reasons.
- Liveness should remain healthy while the process makes progress.
- Restore dependencies before retrying.
- **Never replay an uncertain started write automatically.**

## Execution evidence

The execution detail page shows step and attempt status, queue time, claim
time, start/completion, claimed Agent, target, lease expiry, approval
identity/digest, bounded output, and artifacts.

Troubleshooting guidance separates:

| Category                | Examples                                        |
| ----------------------- | ----------------------------------------------- |
| Configuration errors    | Invalid inputs, missing steps                   |
| Policy rejection        | Agent policy doesn't allow the action           |
| Infrastructure failures | Agent offline, network issues                   |
| Verification failure    | Post-action checks failed (does not undo write) |
| Uncertain writes        | UNKNOWN outcome requiring target inspection     |

## Quick reference

| Problem                | First check                              |
| ---------------------- | ---------------------------------------- |
| Step waiting           | Agent heartbeat + capabilities           |
| UNKNOWN outcome        | Inspect actual target                    |
| Secret transport error | HTTPS + certificate trust                |
| Ambiguous target       | Use specific Agent for writes            |
| Stale preview          | Regenerate preview                       |
| Save conflict          | Reload and reapply                       |
| API 400 error          | Remove `parameters` for bound executions |
| Worker UNKNOWN         | Check worker deployment + heartbeats     |
| Nonce backlog          | Database latency + maintenance metrics   |

## See also

- [Health monitoring](../../guides/runbooks/health) for the health dashboard.
- [Runbook reference](../../reference/runbooks) for limits and state machines.
- [Agent operations](../../operate/deploy/agent-operations) for deployment
  troubleshooting.
