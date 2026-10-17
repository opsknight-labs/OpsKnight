# OpsKnight Runbook Engine — Physical Infrastructure Recovery Evidence

This document establishes concrete, independent, physical evidence of infrastructure changes performed during the End-to-End Enterprise Certification. OpsKnight marked executions are correlated directly with raw operating system, Docker daemon, and Kubernetes API statuses.

---

## 1. Journey A: Fully Automatic Unattended Recovery (Docker Target)

### 1.1 Objective & Test Scope

- **Workload Target**: `ag-e2e-docker-api` (Port 8095:8080, custom HTTP JSON server with healthcheck)
- **Remediation Action**: `DOCKER` `start` (`IDEMPOTENT_WRITE`)
- **Verification Action**: `DOCKER` `health` (`READ_ONLY`)
- **Execution Mode**: `AUTOMATIC` (0 approval gates, fully unattended)
- **Incident Under Test**: `#cmvbgip3` (`CRITICAL: ag-e2e-docker-api container outage`)

### 1.2 Failure Injection & Initial State

1. **Container Stoppage Injected**:
   ```bash
   docker stop ag-e2e-docker-api
   ```
2. **Pre-Remediation Verification**:
   - `docker inspect ag-e2e-docker-api --format '{{.State.Status}} {{.State.Running}}'`:
     ```text
     exited false
     ```
   - HTTP Endpoint Probe:
     ```bash
     curl -s http://127.0.0.1:8095/health
     # Failed: curl: (7) Failed to connect to 127.0.0.1 port 8095: Connection refused
     ```

### 1.3 OpsKnight Trigger & Execution Receipts

- **Automation Rule**: `Auto Remediation Docker API` (`cmvbggld301silnzi9b329eey`) attached to `E2E Docker Service` (`cmvbffoig07q614marj783x7f`).
- **Policy Certification**: Preflight signed policy check validated and transitioned to `PASSED`.
- **Live Ingested Alert**: Prometheus Alertmanager firing webhook alert `DockerContainerDown` to integration endpoint.
- **Incident Created**: `cmvc19s4s0ak311uzuzzvkgex` (`CRITICAL: Container ag-e2e-docker-api is down`).
- **Execution Started**: `cmvc1ez320aun11uz40bb7im6` dispatched to `docker-host-agent` (`cmvbcv9lr02hz14mah9j953nm`).
- **Approval Gates**: 0 (Idempotent write ran without human intervention).

### 1.4 Post-Remediation Physical Proof

1. **Container State**:
   ```bash
   docker inspect ag-e2e-docker-api --format 'Status: {{.State.Status}}, Health: {{.State.Health.Status}}, Running: {{.State.Running}}'
   ```
   **Output**:
   ```text
   Status: running, Health: healthy, Running: true
   ```
2. **HTTP Live Health Response**:
   ```bash
   curl -i http://127.0.0.1:8095/health
   ```
   **Output**:
   ```http
   HTTP/1.1 200 OK
   Content-Type: application/json
   Date: Sat, 17 Oct 2026 06:14:48 GMT
   Connection: keep-alive
   Keep-Alive: timeout=5
   Content-Length: 15

   {"status":"ok"}
   ```
3. **OpsKnight Recorded Execution**:
   - Execution ID: `cmvc1ez320aun11uz40bb7im6`
   - Status: `Succeeded` (100% complete, 2/2 steps, completed in 9.2s).
   - Step 1 Output: `Started container ag-e2e-docker-api`.
   - Step 2 Output: `Container ag-e2e-docker-api is healthy`.
4. **Alertmanager Invariant**:
   - Upon container recovery, Alertmanager auto-emitted resolved payload, transitioning Incident `cmvc19s4s0ak311uzuzzvkgex` to `RESOLVED`.

---

## 2. Journey B & F: Human-Approved Rolling Restart (Kubernetes Target)

### 2.1 Objective & Test Scope

- **Workload Target**: `ag-e2e-k8s-api` Deployment in `opsknight-cert` namespace on Kind cluster (`opsknight-cluster`).
- **Remediation Action**: `KUBERNETES` `rollout-restart` (`NON_IDEMPOTENT`, Approval required).
- **Verification Action**: `KUBERNETES` `rollout-status` (`READ_ONLY`).
- **Execution Mode**: `SUGGESTED` (Triggered on incident, halted for human responder approval).
- **Incident Under Test**: `cmvc1jmy90b5311uz86vclkdr` (`CRITICAL: Kubernetes ag-e2e-k8s-api degraded pod outage`).

### 2.2 Pre-Remediation Physical Failure Baseline

1. **Initial Active ReplicaSet Baseline**:

   ```bash
   kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o wide
   ```

   **Output**:

   ```text
   NAME                              READY   STATUS    RESTARTS   AGE   IP            NODE
   ag-e2e-k8s-api-844c84d7b6-lhx4h   1/1     Running   0          52m   10.244.0.12   opsknight-cluster-control-plane
   ag-e2e-k8s-api-844c84d7b6-z8547   1/1     Running   0          52m   10.244.0.13   opsknight-cluster-control-plane
   ```
   - Active ReplicaSet Hash: `844c84d7b6`.
   - Pod Instances: `10.244.0.12`, `10.244.0.13`.

2. **Degraded Workload State Injected**:
   - Workload simulated transient deadlock / stale configuration.
   - Prometheus Alertmanager triggered webhook `K8sDeploymentDegraded` to integration endpoint.
   - Incident `cmvc1jmy90b5311uz86vclkdr` created in OpsKnight control plane.

### 2.3 OpsKnight Governance & Approval Gate

- **Trigger**: Incident created `cmvc1jmy90b5311uz86vclkdr` on `E2E Kubernetes Service`.
- **Safety Rule Enforced**: Automatic non-idempotent budget = 0. OpsKnight evaluated trigger and matched `E2E K8s Restart Recovery` (v2 pinned) under **Suggested**.
- **Execution Started**: `cmvc1kgro0b7211uzueewpqtr`.
- **Approval Gate Enforced**:
  - Execution paused at `Waiting approval`.
  - Step 1 (`Restart Kubernetes deployment`) status transitioned to `WAITING_APPROVAL`.
  - Step parameters displayed: Deployment `ag-e2e-k8s-api`, namespace `opsknight-cert`, target `test-cert-agent-ui`.
- **Human Approval Interaction**:
  - Responder approved exact plan in OpsKnight UI.
  - Cryptographic approval recorded: `Approved by OpsKnight Admin · Oct 17, 2026 · cmvc1kgro...`.

### 2.4 Agent Dispatch & In-Cluster Execution

- In-cluster agent `test-cert-agent-ui` (`cmvbc66tm01c414mafgksn6zk`) inside pod `opsknight-agent-agent-575ccbc878-czdfc` received dispatch.
- Agent executed `kubectl rollout restart deployment/ag-e2e-k8s-api -n opsknight-cert`.

### 2.5 Post-Remediation Physical Proof

1. **Fresh Pods & ReplicaSet Replacement**:

   ```bash
   kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o wide
   ```

   **Output**:

   ```text
   NAME                              READY   STATUS    RESTARTS   AGE   IP            NODE
   ag-e2e-k8s-api-677cf4dfc5-2h8sk   1/1     Running   0          38s   10.244.0.18   opsknight-cluster-control-plane
   ag-e2e-k8s-api-677cf4dfc5-m4z9l   1/1     Running   0          38s   10.244.0.19   opsknight-cluster-control-plane
   ```
   - **ReplicaSet Hash**: `844c84d7b6` → **`677cf4dfc5`** (Physical proof of rolling restart: new pods scheduled, old terminated).
   - **Pod IPs Reallocated**: `10.244.0.12`/`13` → **`10.244.0.18`/`19`**.
   - **Ready Count**: 2/2 pods ready.

2. **Rollout Status Verification**:

   ```bash
   kubectl rollout status deployment/ag-e2e-k8s-api -n opsknight-cert
   ```

   **Output**:

   ```text
   deployment "ag-e2e-k8s-api" successfully rolled out
   ```

3. **OpsKnight UI Evidence**:
   - Execution ID: `cmvc1kgro0b7211uzueewpqtr`.
   - Execution status: `Succeeded` (100% complete, 2/2 steps).
   - Step 1 Output: `deployment.apps/ag-e2e-k8s-api restarted`.
   - Step 2 Output: `deployment "ag-e2e-k8s-api" successfully rolled out`.
   - Incident `cmvc1jmy90b5311uz86vclkdr` resolved.

---

## 3. Kubernetes Orchestration Mechanics: Restart vs Scale

To ensure strict causal integrity in certification audits:

1. **Rolling Restart (`rollout-restart`)**:
   - Modifies pod template annotation `kubectl.kubernetes.io/restartedAt`.
   - Causes Kubernetes Deployment controller to perform a zero-downtime rolling update across existing configured replicas (`.spec.replicas`).
   - Does **not** change `.spec.replicas`. Used for refreshing hung workloads, applying configuration updates, or clearing transient in-memory faults.

2. **Replica Scaling (`scale`)**:
   - Directly mutates `.spec.replicas` (e.g. `0` → `2`).
   - Governed by `kubernetesMaxReplicas` local agent policy limits (`agent/src/policy.ts`).
   - Used for horizontal autoscaling recovery or bringing drained deployments back online.

---

## 4. Journey F: Unattended Kubernetes Scale Recovery (Scaling 0 → 2 Replicas)

### 4.1 Objective & Test Scope

- **Audit Finding Resolved**: P0 Audit finding regarding rollout-restart vs scaling. A rollout-restart does not change `.spec.replicas` from 0 to 2; an explicit `scale` operation is required.
- **Workload Target**: `ag-e2e-k8s-api` Deployment in `opsknight-cert` namespace on Kind cluster (`opsknight-cluster`).
- **Remediation Action**: `KUBERNETES` `scale` with `replicas: 2` (`riskClass: IDEMPOTENT_WRITE`, `requiresApproval: false`).
- **Verification Action**: `KUBERNETES` `rollout-status` (`riskClass: READ_ONLY`).
- **Execution Mode**: `AUTOMATIC` (0 approval gates, fully unattended execution).
- **Runbook**: `E2E K8s Scale Recovery` v2 (`cmvc66rxh0l4o11uz36ro5ugx`).

### 4.2 Failure Injection & Zero-Replica Outage State

1. **Physical Scale-to-Zero Outage Injected**:
   ```bash
   kubectl scale deployment/ag-e2e-k8s-api --replicas=0 -n opsknight-cert
   ```
2. **Pre-Remediation Verification**:
   ```bash
   kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api
   # No resources found in opsknight-cert namespace.
   kubectl get deployment/ag-e2e-k8s-api -n opsknight-cert -o jsonpath='{.spec.replicas}'
   # 0
   ```

### 4.3 OpsKnight Unattended Execution & Recovery

- **Execution ID**: `cmvc6dcet0`
- **Target**: `test-cert-agent-ui` (`cmvbc66tm01c414mafgksn6zk`) inside pod `opsknight-agent-agent-575ccbc878-czdfc`.
- **Duration**: 6 seconds (completed 2/2 steps, 100% complete).
- **Approval Gate**: 0 approvals required (`IDEMPOTENT_WRITE` scale operation executed without human interruption).

### 4.4 Post-Remediation Physical Proof

1. **Replica Count & Pod Allocation**:
   ```bash
   kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o wide
   ```
   **Output**:
   ```text
   NAME                              READY   STATUS    RESTARTS   AGE   IP            NODE
   ag-e2e-k8s-api-677cf4dfc5-5p2ql   1/1     Running   0          42s   10.244.0.33   opsknight-cluster-control-plane
   ag-e2e-k8s-api-677cf4dfc5-k98jx   1/1     Running   0          42s   10.244.0.34   opsknight-cluster-control-plane
   ```
2. **Rollout Status**:
   ```bash
   kubectl rollout status deployment/ag-e2e-k8s-api -n opsknight-cert
   # deployment "ag-e2e-k8s-api" successfully rolled out
   ```
   - Ready Pods: **2/2**.
   - Pod IPs: `10.244.0.33`, `10.244.0.34`.

---

## 5. Journey G: Native Linux Systemd & Rootless Podman Remediation

### 5.1 Objective & Test Scope

- **Host Target**: `opsknight-cluster-control-plane` (Linux host with systemd PID 1 and rootless Podman runtime).
- **Outbound Agent**: `linux-native-host-agent` (`cmvc6jewu00cs16noj7104weo`), native systemd service unit `opsknight-agent.service` (PID 184364).
- **Verified Capabilities**: `SYSTEMD`, `PODMAN` (rootless container runtime), `BASH`, `LINUX_DIAGNOSTICS`.
- **Published Runbook**: `E2E Native Systemd and Podman Suite` v1 (`cmvc74yhq01vh16nohq6nn1ym`).
- **Incident Under Test**: `cmvc7o4jj00yor4wg9y2evtzl` (`E2E Native Systemd and Podman Outage`).

### 5.2 Pre-Remediation Physical Failure Baseline

1. **Systemd Service Baseline**:
   - `cert-sample.service` running PID **170592** (active for 45min).
2. **Podman Container Baseline**:
   - Container `6bd48e7de9e8` (`cert-podman-api`) in stopped state:
     ```text
     CONTAINER ID  IMAGE                            STATUS
     6bd48e7de9e8  docker.io/library/alpine:latest  Exited (0) 51 minutes ago
     ```

### 5.3 OpsKnight Governance & 7-Step Execution Receipts

- **Execution ID**: `cmvc7w4xt01n9r4wgcswc6x2l`
- **Target**: `linux-native-host-agent` (`cmvc6jewu00cs16noj7104weo`)
- **Status**: `Succeeded` (1m 10s, 7/7 steps complete, 100%)
- **Timeline & Physical Proof**:
  1. `STEP 1` **Capture Host Diagnostics** (`LINUX_DIAGNOSTICS`, `READ_ONLY`): Succeeded in 3s, collected 3 host diagnostic evidence artifacts.
  2. `STEP 2` **Precheck systemd status** (`SYSTEMD`, `READ_ONLY`): Succeeded in 4s, captured service state prior to mutation.
  3. `STEP 3` **Restart cert-sample.service** (`SYSTEMD`, `NON_IDEMPOTENT`, Approval Gate):
     - Execution halted at approval gate.
     - Responder approved exact plan in UI (`Approved by OpsKnight Admin · Oct 17, 2026, 3:22 PM GMT+5:30 · e41309cddeb992db…`).
     - Succeeded in 1s.
     - **Physical proof**: `systemctl status cert-sample.service` confirmed service restarted; Main PID changed from `170592` → `184782` (`active since Sat 09:52:27 UTC`).
  4. `STEP 4` **Verify systemd status** (`SYSTEMD`, `READ_ONLY`): Succeeded in 1s, verified service is active and running.
  5. `STEP 5` **Precheck podman container inspect** (`DOCKER` runtime podman, `READ_ONLY`): Succeeded in 4s (using resolved `.ID` format template).
  6. `STEP 6` **Restart cert-podman-api Container** (`DOCKER` runtime podman, `NON_IDEMPOTENT`, Approval Gate):
     - Execution halted at approval gate.
     - Responder approved exact plan in UI (`Approved by OpsKnight Admin · Oct 17, 2026, 3:22 PM GMT+5:30 · e187fdcd8362f63d…`).
     - Succeeded in 1s.
     - **Physical proof**: `podman ps -a` confirmed container `cert-podman-api` transitioned from `Exited (0) 51 minutes ago` → **`Up 26 seconds`**!
  7. `STEP 7` **Verify podman container inspect** (`DOCKER` runtime podman, `READ_ONLY`): Succeeded in 4s, verified container is up and healthy.

---

## 6. Journey H: Multi-Agent Fleet Pool Execution

### 6.1 Objective & Test Scope

- **Target**: `Pool · E2E Fleet Pool` (`cmvbde37o03hf14malayilfy6`, mode: `SHARED_TARGET`, 2 Agents: `docker-host-agent` and `test-cert-agent-ui`).
- **Published Runbook**: `Automated Docker Container Recovery` v2.
- **Incident Under Test**: `cmvc7o4jj00yor4wg9y2evtzl` (`E2E Native Systemd and Podman Outage`).

### 6.2 Execution Receipts

- **Execution ID**: `cmvc81xvo025ar4wgxkp2hbc0`
- **Target**: `Pool · E2E Fleet Pool (SHARED_TARGET)`
- **Dispatched Agent**: `docker-host-agent` (`cmvbcv9lr02hz14mah9j953nm`) selected dynamically based on matching `DOCKER` runtime capability.
- **Status**: `Succeeded` (8s duration, 2/2 steps complete, 100%).
- **Steps**:
  - `STEP 1` `start_docker_container` (`DOCKER`, `IDEMPOTENT_WRITE`): Succeeded in 3s.
  - `STEP 2` `verify_docker_health` (`DOCKER`, `READ_ONLY`): Succeeded in 4s.

---

## 7. UI-Driven Scoped Secrets Lifecycle Receipts

### 7.1 Scope & Verification

All Scoped Secret operations were driven 100% through the real UI at `https://opssentinal.com/runbooks/agents/secrets`:

1. **Secret Creation**:
   - Modal opened: `Create scoped secret`.
   - Name: `cert-api-token` (validated against lowercase slug regex `^[a-z0-9-]+$`).
   - Value: `OpsKnight_Super_Secret_2026!`.
   - Initial grant: `Agent · docker-host-agent`.
   - Value masked immediately as `••••••••`.
2. **Grant Management**:
   - Secondary grant added via UI: `Pool · E2E Fleet Pool`.
   - Both grants active and reflected in grants table.
3. **Secret Rotation**:
   - Rotated value in UI: `OpsKnight_Rotated_Secret_Value_999!`.
   - Checked mandatory `confirmRotation` acknowledgment.
   - Version incremented and confirmed.
4. **Grant Revocation**:
   - Revocation clicked for `docker-host-agent`.
   - Confirmation alertdialog approved.
   - Grant removed cleanly; remaining grant count: 1.
