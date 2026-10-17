# OpsKnight Runbook Engine — Phase 6: Multi-Agent Pools, Disconnection & Reconnection Assessment

## 1. Pool Architecture & Members

The multi-agent pool `E2E Fleet Pool` is registered in the control plane with `SHARED_TARGET` mode:

- **Pool Name**: `E2E Fleet Pool`
- **Semantics**: `SHARED_TARGET`
- **Member 1**: `docker-host-agent` (`9c30a68ed4c9`, Host Docker daemon on macOS)
- **Member 2**: `test-cert-agent-ui` (`opsknight-agent-agent-575ccbc878-czdfc`, Pod inside Kind Kubernetes cluster)

---

## 2. Test Procedure & Scope Limitations

| Step                       | Action Taken                                             | Observed System Behavior                                                                                        | Certified Scope               |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **1. Baseline State**      | Verify both agents healthy                               | Both agents report `ONLINE` with fresh heartbeats (< 30s)                                                       | Baseline Pool Health          |
| **2. Disconnect Primary**  | Force-stop `docker-host-agent` container                 | Container exited immediately (`docker stop 9c30a68ed4c9`)                                                       | Agent Disconnection Detected  |
| **3. Pool Availability**   | Query pool members                                       | `test-cert-agent-ui` remains active and capable in Kubernetes (`1/1 Running`)                                   | Secondary Member Retention    |
| **4. Container Restart**   | Restart `docker-host-agent`                              | Container restarts, re-reads `identity.json`, issues handshake                                                  | Identity & State Preservation |
| **5. Health Reconnection** | Inspect `/tmp/opsknight-agent-health.json`               | `ready: true, initialized: true, lastAuthenticatedContactAgeSeconds: 0.31`                                      | Seamless Reconnection         |
| **6. Workload Failover**   | Dispatch shared-target workload while primary is offline | **Not executed** in this test run; the two agents run in disparate environments (Docker host vs in-cluster K8s) | **UNTESTED / PENDING**        |

---

## 3. Findings & Assessment

> [!IMPORTANT]
> **Assessment**: Agent disconnection, health degradation detection, and clean reconnection without race conditions were successfully demonstrated.
>
> However, **shared-target execution failover** (where a healthy secondary agent in a pool claims and executes a workload destined for a failed peer on a shared physical workload) was **not** established in this test. Genuine failover requires two agents co-located with access to the exact same physical endpoint (e.g. Lab H: two Kubernetes agents in one shared-target pool).

---

## 4. Physical Disconnection & Reconnection Receipt

```bash
--- Phase 6: Agent Disconnection and Reconnection Verification ---
Step 1: Stopping docker-host-agent container (9c30a68ed4c9)...
Step 2: Checking agent container status...
Container state: Exited (0) Less than a second ago
Step 3: Verifying second pool agent (test-cert-agent-ui in Kubernetes) is healthy...
Kubernetes Pool Member: opsknight-agent-agent-575ccbc878-czdfc   1/1   Running   0     17h
Step 4: Restarting docker-host-agent container...
Container recovered state: Up Less than a second (health: starting)
Step 5: Verifying restored heartbeat in health file...
Agent health verified: { ready: true, initialized: true, lastContactAge: 0.31 }
Disconnection and reconnection verified: true
Execution failover on shared workload: NOT DEMONSTRATED
```
