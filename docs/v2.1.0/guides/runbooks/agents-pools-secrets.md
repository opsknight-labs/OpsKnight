---
title: Manage Agents, pools, and scoped secrets
description: Enroll outbound Agents, choose pool semantics, grant secret access, rotate credentials, and inspect health.
type: how-to
product_area: runbooks
audience: [administrator, operator]
verification:
  level: test
  verified_at: 2026-10-04
  evidence: [src/app/(app)/runbooks/agents/page.tsx, src/components/runbooks/AgentEnrollmentForm.tsx, tests/e2e/runbooks-ui.spec.ts, src/lib/runbooks/secrets.ts]
---

# Manage Agents, pools, and scoped secrets

Open **Runbooks → Agents**. Its Agents, Pools, and Secrets tabs separate
execution infrastructure from credentials. Agent/pool management requires
`runbook.agent.manage`; secret administration requires `runbook.secret.manage`.

## Enroll an Agent

Choose **Add Agent**, enter its name and expected hostname, and create enrollment.
Copy the one-time token immediately: it expires after 15 minutes and cannot be
displayed again. Follow the UI setup instructions and pin the trusted execution
public key. Review the local policy before installation.

Persist the Agent identity and result spool in a dedicated volume. Do not share
that volume across simultaneous Agent instances. Installation examples for
Compose, Helm, Kustomize, Swarm, and native operation are in
[Agent operations](../../operate/deploy/agent-operations).

Verify heartbeat, platform/version, configured capabilities, policy hash, spool
depth, dead letters, and reported errors. A new enrollment alone does not mean
an Agent is online or authorized to execute a write.

## Create and manage pools

In **Pools → Create pool**, choose semantics explicitly:

- **Shared target:** every healthy member reaches the same target.
- **Local hosts:** each Agent represents a different machine; writes require
  a specific Agent when the pool has multiple members.

Open **Manage pool** to add an Agent or confirm membership removal. Recheck
bindings after membership changes; membership can change which future claims
are eligible. It never grants operating-system or cluster privileges.

## Create, grant, and rotate secrets

In **Secrets → Create secret**, enter the name, credential value, optional
description, and initial Agent/pool grant. The credential is encrypted at rest
and masked in the UI. Reference it with a `SECRET_REF` input rather than pasting
credentials into definitions or binding values.

Open **Manage grants / Rotate** to grant another target, confirm grant revocation,
or provide a new secret value and rotate it. Rotation updates the stored
credential; it does not rotate the credential in the upstream provider for you.
Previously resolved values cannot be recalled by revoking a grant.

Secret-backed Agent steps require HTTPS to the control plane and an applicable
grant. The Agent must trust the control-plane certificate. Plain HTTP diagnostics
do not establish confidential transport for credentials. Never print secrets
in commands or diagnostic output, even though output redaction is provided.

## Monitor health

**Runbooks → Health** reports queue age, artifact storage, unknown outcomes,
expired leases, circuit-breaker indicators, and Agents requiring attention.
Worker status is local to the current process; a split web process cannot
certify the whole worker fleet. Monitor worker readiness endpoints separately.
For recovery procedures, see [Runbook troubleshooting](../../troubleshooting/runbooks/).
