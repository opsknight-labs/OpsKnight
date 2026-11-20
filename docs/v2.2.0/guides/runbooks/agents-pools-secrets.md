---
title: Manage Agents, pools, and scoped secrets
description: Enroll outbound Agents, choose pool semantics, grant secret access, rotate credentials, and inspect health.
type: how-to
product_area: runbooks
audience: [administrator, operator]
verification:
  level: test
  verified_at: 2026-10-15
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

## Prerequisites

- OpsKnight instance reachable over HTTPS from the intended Agent host or
  network.
- Administrative account with `runbook.agent.manage` and
  `runbook.secret.manage` permissions.
- Host, Kubernetes cluster, or container engine ready to execute the OpsKnight
  Agent.

## Agent architecture

Agents are **outbound-only** — they poll the control plane for signed work.
They do not expose inbound command endpoints. Each Agent:

- Generates its own keypair during enrollment (private key never leaves the
  host).
- Verifies the control plane's signature before executing any step.
- Signs every API call for mutual authentication.
- Reports health, capabilities, and policy hash via heartbeat.

## Enroll an Agent

### Enrollment flow

1. Navigate to **Runbooks → Agents** and select **Add Agent**.
2. Enter the Agent name (max 200 chars) and optional hostname hint (max 255
   chars).
3. Select **Create enrollment**.
4. **Copy the one-time enrollment token immediately** — it expires after
   **15 minutes** and cannot be displayed again.
5. Run the setup instructions on the target host or cluster.
6. Follow the UI setup instructions and pin the trusted execution public key.

### What happens during enrollment

| Step               | Details                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Token creation     | Server generates a random 32-byte `base64url` token (stored as SHA-256 hash)                       |
| Agent installation | Operator deploys the Agent with the token. Agent generates its own keypair                         |
| Handshake          | Agent POSTs its public key + hostname. Token hash matched; status transitions `ENROLLING → ONLINE` |

### Deployment methods

| Method            | Notes                                       |
| ----------------- | ------------------------------------------- |
| Docker Compose    | Standard container deployment               |
| Docker Swarm      | Pin to the node holding Agent's local state |
| Helm (Kubernetes) | Uses separate `opsknight-agent` chart       |
| Kustomize         | Kubernetes native                           |
| Native Linux      | Direct binary installation                  |

The setup commands deploy only the Agent and connect to an existing OpsKnight
installation. Set **OpsKnight URL from Agent** to an address reachable from
its host or cluster; use HTTPS for secret-backed steps.

### Post-enrollment verification

After enrollment, verify:

- ✅ Heartbeat freshness (must be within 90 seconds)
- ✅ Platform/version reporting
- ✅ Configured vs. effective capabilities
- ✅ Policy hash
- ✅ Spool depth and dead letters
- ✅ Reported errors

A new enrollment alone does not mean an Agent is online or authorized to
execute a write.

## Agent authentication protocol

Each API call from Agent to control plane is cryptographically signed:

```
METHOD\n<canonical-path>\n<ISO-timestamp>\n<nonce>\n<sha256(body)>
```

| Component           | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| Signature algorithm | Ed25519/ECDSA PEM                                                |
| Signature window    | `AGENT_SIGNATURE_WINDOW_MS`                                      |
| Replay prevention   | Nonces stored in `RunbookAgentRequestNonce` table                |
| Key storage         | Agent's private key stays on host; public key stored in database |

## Agent status lifecycle

```
ENROLLING → ONLINE → DEGRADED → OFFLINE → REVOKED
```

| Status      | Meaning                                       | Transition                       |
| ----------- | --------------------------------------------- | -------------------------------- |
| `ENROLLING` | Token issued, Agent not yet connected         | Handshake → ONLINE               |
| `ONLINE`    | Fresh heartbeat within 90 seconds             | Automatic                        |
| `DEGRADED`  | Heartbeat present but runtime faults reported | Automatic                        |
| `OFFLINE`   | Missed heartbeat (>90s)                       | Computed at query time           |
| `REVOKED`   | Permanently decommissioned                    | Manual — requires new enrollment |

Revoked Agents cannot be upgraded in place — create a new enrollment.

## Agent capabilities

Agents probe configured binaries and runtime access before heartbeats. The
UI distinguishes **configured** from **effective** capabilities:

| Capability        | Required for                   |
| ----------------- | ------------------------------ |
| Linux diagnostics | LINUX_DIAGNOSTICS steps        |
| Systemd           | SYSTEMD steps                  |
| Docker            | DOCKER steps (runtime: docker) |
| Podman            | DOCKER steps (runtime: podman) |
| Kubernetes        | KUBERNETES steps               |
| Bash              | BASH steps                     |

Probes are bounded and read-only. They never grant Unix privileges or
Kubernetes RBAC. Scheduling uses effective capabilities and distinguishes
Docker from Podman.

## Create and manage pools

In **Pools → Create pool**, choose semantics explicitly:

| Mode            | Behavior                                     | Write targeting                                        |
| --------------- | -------------------------------------------- | ------------------------------------------------------ |
| `SHARED_TARGET` | Every healthy member reaches the same target | Any eligible member selected                           |
| `LOCAL_HOSTS`   | Each Agent represents a different machine    | Writes require a specific Agent for multi-member pools |

Pool mode is **immutable after creation** in the UI.

### Pool membership

| Source     | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `EXPLICIT` | Manually added via UI/API                                       |
| `SELECTOR` | Dynamic — computed when Agent `labels` match pool `matchLabels` |

Open **Manage pool** to add an Agent or confirm membership removal. Recheck
bindings after membership changes. Adding an Agent to a pool with existing
secret grants may require `runbook.secret.manage` capability.

Removing a dynamic member requires changing the selector or the Agent's
labels. Membership alone never grants operating-system or cluster privileges.

## Create, grant, and rotate secrets

### Create a secret

In **Secrets → Create secret**:

1. Enter the name (unique, lowercase alphanumeric + hyphens).
2. Enter the credential value (encrypted at rest, never displayed).
3. Add optional description.
4. Set initial Agent/pool grant.

### Grant model

Secrets are **not global** — they must be explicitly granted to:

- A specific Agent (`agentId`), or
- A specific pool (`agentPoolId`).

Each grant is unique per (secret, Agent) or (secret, pool) pair.

### Use in steps

Reference secrets with a `SECRET_REF` input: `secret://payments-api-token`.
At dispatch, the server resolves the reference and injects the value into the
step payload. The Agent must have:

- HTTPS connection to the control plane.
- An applicable grant for the secret.
- Trust of the control-plane certificate.

HTTP steps **cannot** consume `SECRET_REF` inputs directly — use an Agent
executor with the grant.

### Rotate a secret

Open **Manage grants / Rotate** to:

- Grant another target.
- Confirm grant revocation (in-progress steps cannot be recalled).
- Provide a new secret value.

Rotation updates the stored credential immediately. New steps resolve the new
value; previously resolved values cannot be recalled. Rotation does **not**
rotate the credential in the upstream provider.

### Secret transport security

- Secret-backed steps require HTTPS to the control plane.
- Plain HTTP diagnostics do not establish confidential transport.
- Never print secrets in commands or diagnostic output, even though output
  redaction is provided.
- The `requiresConfidentialTransport` flag is set on attempts with secrets.

## Monitor health

**Runbooks → Health** reports queue age, artifact storage, unknown outcomes,
expired leases, circuit-breaker indicators, and Agents requiring attention.

For detailed health monitoring, see [Health and monitoring](./health).
For recovery procedures, see [Runbook troubleshooting](../../troubleshooting/runbooks/).

## Enrollment and policy evidence

Setup commands are available only for a verified published server/Agent pair
and a confirmed real HTTPS endpoint. Tokens are captured through a hidden
prompt or protected file, expire after 15 minutes, and can be revoked by
canceling enrollment.

Persist each independent Agent's identity and spool volume:

- Do not share volumes across simultaneous Agent instances.
- Swarm Agents are pinned to the node holding their local state.
- Installation examples are in [Agent operations](../../operate/deploy/agent-operations).

### Swarm Agent local health state

The Agent stack mounts `/tmp` through an explicit `type: tmpfs` volume with a
16 MiB limit. Keep the explicit mount when customizing the stack: the
non-root Agent needs it to publish `/tmp/opsknight-agent-health.json` with a
read-only root filesystem.

A missing or stale health file fails liveness. Health publication failures are
logged as `Agent Health Error`. Readiness additionally checks authenticated
control-plane contact. A control-plane outage alone does not fail liveness.

## See also

- [Agent operations](../../operate/deploy/agent-operations) for deployment
  prerequisites and topology-specific guidance.
- [Permissions](./permissions) for all required capabilities.
- [Health monitoring](./health) for fleet-wide health dashboard.
