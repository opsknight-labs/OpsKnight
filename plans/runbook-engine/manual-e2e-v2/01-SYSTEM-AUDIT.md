# Phase 1 — System Audit & Code Contract Verification

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Target Environment:** OpsKnight SaaS (`https://opssentinal.com`) with Local Execution Agents  
**Git Working Tree:** `feat/runbook-full-automatic-e2e-certification` (based on clean `main` post PR #888)

---

## 1. Architectural Architecture & Core Findings

The OpsKnight Runbook Engine is designed for secure, distributed, least-privilege automated incident remediation. The system strictly separates the **Control Plane** (`https://opssentinal.com`), the **Outbound Runbook Agents** (`opsknight-agent`), and the **Target Infrastructure** (Docker containers, Kubernetes clusters, Linux systemd units, Podman workloads).

```
+-----------------------------------------------------------------------------------+
|                            OpsKnight SaaS Control Plane                            |
|                            https://opssentinal.com                                |
|                                                                                   |
|  [External Ingest Webhooks]  --->  [Incident Lifecycle Engine]                   |
|  (Prometheus Alertmanager)         (SLA tracking, state machine)                  |
|                                                  |                                |
|                                                  v                                |
|  [Runbook Authoring Engine]  --->  [Service Automation Rules]                     |
|  (Versioned immutable JSON)        (Pinned version, match filters, budgets)       |
|                                                  |                                |
|                                                  v                                |
|                              [Cryptographic Dispatch Boundary]                    |
|                              (Ed25519 Execution Signing)                          |
+-----------------------------------------------------------------------------------+
                                         ^
                                         | Outbound HTTPS Mutual Lease Polling
                                         | (Heartbeats, Step Claim, Result Delivery)
+-----------------------------------------------------------------------------------+
|                             Outbound Runbook Agent Fleet                          |
|                                                                                   |
|  Agent: docker-host-agent                     Agent: test-cert-agent-ui           |
|  Platform: Docker / Mac Host                  Platform: Kubernetes Kind Cluster   |
|  Container: 9c30a68ed4c9                      Namespace: opsknight                |
|  Identity: Volume-staged private key          Identity: K8s Secret                |
|  Policy: docker-policy.json (ro)              Policy: ConfigMap policy.json (ro)  |
|  Runtime: read-only rootfs + tmpfs            Runtime: non-root 1001 user         |
+-----------------------------------------------------------------------------------+
             |                                              |
             v Docker Socket (/var/run/docker.sock)         v In-cluster Kubeconfig / RBAC
+------------------------------------+        +-------------------------------------+
|        Docker Test Workload        |        |      Kubernetes Test Workload       |
|  Container: ag-e2e-docker-api      |        |  Deployment: ag-e2e-k8s-api         |
|  Port: 8095 -> 8080                |        |  Namespace: opsknight-cert          |
|  Health: Docker native HEALTHCHECK |        |  Replicas: 2/2 ready                |
+------------------------------------+        +-------------------------------------+
```

---

## 2. Code Contracts & Runtime Fixes

During this end-to-end certification audit, multiple critical enterprise gaps were identified in the codebase, analyzed at the root cause, and permanently resolved:

### 2.1 Canonical Runtime Environment Variables (`agent/src/index.ts`)

- **Discovery:** The Agent setup instructions generated variable names (`OPSKNIGHT_URL`, `OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_FILE`, `OPSKNIGHT_AGENT_POLICY_FILE`) that differed from legacy internal references (`OPSKNIGHT_AGENT_URL`, `OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_PATH`, `OPSKNIGHT_AGENT_POLICY_PATH`).
- **Fix:** Implemented bidirectional canonical resolution with backward-compatible fallbacks:
  ```ts
  const rawUrl = process.env.OPSKNIGHT_URL ?? process.env.OPSKNIGHT_AGENT_URL;
  const tokenFile =
    process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_FILE ??
    process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_PATH;
  const policyFile =
    process.env.OPSKNIGHT_AGENT_POLICY_FILE ?? process.env.OPSKNIGHT_AGENT_POLICY_PATH;
  ```

### 2.2 Token Lifecycle & Durable Volume Pre-Staging (`src/lib/runbooks/agent-setup-commands.ts`)

- **Discovery:** Mounting host directories directly for the one-time enrollment token (`$agent_credential_dir/enrollment-token`) caused two critical bugs:
  1. A race condition where host cleanup deleted the token before container initialization.
  2. Subsequent container restarts failed with `mount: no such file or directory` because the host directory no longer existed.
- **Fix:** Docker and Podman setup commands now stream the token directly into the named container volume `${deployment.name}_data:/var/lib/opsknight-agent/enrollment-token` prior to container daemon start.
- **Automatic Unlink:** In `agent/src/index.ts`, `loadIdentity` safely unlinks `tokenFile` once the persistent Ed25519 keypair is written to disk, preventing plaintext token retention while gracefully handling read-only mounts.

### 2.3 Container Healthcheck Startup Race Condition (`agent/src/executor.ts`)

- **Discovery:** When `start_docker_container` starts an exited container, Docker immediately marks `State.Health.Status = "starting"` until the first probe completes. The subsequent `verify_docker_health` step failed with `CONTAINER_UNHEALTHY` because it executed a single check without waiting for the initial probe to pass.
- **Fix:** Added `isContainerStarting(output)` and polling loop in `executeAttempt` for `action === 'health'`:
  ```ts
  while (
    !containerHealthPassed(result.output) &&
    isContainerStarting(result.output) &&
    Date.now() - startCheckTime < maxWaitMs &&
    !signal.aborted
  ) {
    await new Promise(r => setTimeout(r, 1000));
    if (signal.aborted) break;
    const retry = await executeCommand(attempt, policy, signal);
    result.output = retry.output;
  }
  ```
  This cleanly bridges the Docker startup window (typically 2-4 seconds) and guarantees that healthy containers transition to `healthy` and pass verification without false alarms.

---

## 3. Verification & Test Evidence

- Unit tests in `tests/lib/runbooks/agent-deployment.test.ts`: 6/6 tests passing.
- Unit tests in `tests/lib/runbooks/agent-executor.test.ts`: 13/13 tests passing (including `isContainerStarting` and `containerHealthPassed` contracts).
- Runbook engine test suite in `tests/lib/runbooks/`: 362/362 tests passing.
- TypeScript type check: 0 errors (`tsc --noEmit` exited code 0).
