---
title: Manage Agents, pools, and scoped secrets
description: Enroll outbound Agents, choose pool semantics, grant secret access, rotate credentials, and inspect health.
type: how-to
product_area: runbooks
audience: [administrator, operator]
verification:
  level: test
  verified_at: 2026-10-14
  evidence:
    [
      src/app/(app)/runbooks/agents/page.tsx,
      src/components/runbooks/AgentEnrollmentForm.tsx,
      tests/e2e/runbooks-ui.spec.ts,
      src/lib/runbooks/secrets.ts,
    ]
---

# Manage Agents, pools, and scoped secrets

Open **Runbooks → Agents**. Its Agents, Pools, and Secrets tabs separate
execution infrastructure from credentials. Agent/pool management requires
`runbook.agent.manage`; secret administration requires `runbook.secret.manage`.

## Enroll an Agent

Choose **Add Agent**, enter its name and optional hostname hint, and create enrollment.
Copy the one-time token immediately: it expires after 15 minutes and cannot be
displayed again. Follow the UI setup instructions and pin the trusted execution
public key. The hostname hint is initial metadata, not a hostname restriction; enrollment records the Agent-reported hostname. Review the local policy before installation.

The setup commands deploy only the Agent and connect to an existing OpsKnight installation. Set **OpsKnight URL from Agent** to an address reachable from its host or cluster; use HTTPS for secret-backed steps. Helm uses the separate `opsknight-agent` chart. The Compose policy path applies only to Compose; review the policy for each other deployment method separately.

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

## Enrollment and policy evidence

Setup commands are available only for a verified published server/Agent pair and a confirmed real HTTPS endpoint. Tokens are captured through a hidden prompt or protected file, expire after 15 minutes, and can be revoked by canceling enrollment. Preserve each independent Agent's identity and spool volume. Swarm Agents are pinned to the node holding their local state.

A service rule's **Check Agent policy** is a signed allowlist check with no execution. It does not grant OS, Docker or Kubernetes permissions. A containerized Agent cannot inspect the host's Systemd service without explicit host integration. Follow [Agent operations](../../operate/deploy/agent-operations) for topology-specific prerequisites and separate readiness/liveness behavior.
