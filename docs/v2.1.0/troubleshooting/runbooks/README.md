---
title: Troubleshoot Runbooks
description: Diagnose waiting executions, unavailable Agents, confidential transport errors, ambiguous targets, and uncertain outcomes safely.
type: troubleshooting
product_area: runbooks
audience: [responder, administrator, operator]
verification:
  level: source
  verified_at: 2026-10-04
  evidence: [src/lib/runbooks/agent-claims.ts, src/lib/runbooks/reconciler.ts, src/app/(app)/runbooks/health/page.tsx, agent/src/lease.ts]
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
